// Starts API + web dev servers, picking a free API port (3001+) when the default is taken.
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { DEFAULT_API_PORT } from "./ports.mjs";

function isFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

let port = Number(process.env.PORT ?? DEFAULT_API_PORT);
if (process.env.PORT === undefined) {
  for (let i = 0; i < 20 && !(await isFree(port)); i++) port++;
}
if (!(await isFree(port))) {
  console.error(`API port ${port} is in use; set PORT to a free port.`);
  process.exit(1);
}
if (port !== DEFAULT_API_PORT) {
  console.log(`[dev] port ${DEFAULT_API_PORT} busy, API will use ${port} (the MCP server finds it automatically)`);
}

// Run concurrently's JS entry point with node itself, without a shell. Going through
// `npx` with `shell: true` breaks on Windows: the command line is not quoted, so
// "npm run dev -w server" reaches concurrently as separate arguments.
const require = createRequire(import.meta.url);
const packageJsonPath = require.resolve("concurrently/package.json");
const concurrentlyBin = path.join(path.dirname(packageJsonPath), require(packageJsonPath).bin.concurrently);

const child = spawn(
  process.execPath,
  [concurrentlyBin, "-n", "server,web", "-c", "blue,green", "npm run dev -w server", "npm run dev -w web"],
  { stdio: "inherit", env: { ...process.env, PORT: String(port), API_PORT: String(port) } },
);

child.on("error", (err) => {
  console.error(`[dev] could not start concurrently: ${err.message}`);
  process.exit(1);
});
// A child killed by a signal has no exit code; that is a failure, not success.
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
