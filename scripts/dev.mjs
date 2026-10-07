import { DEFAULT_API_PORT } from "./ports.mjs";
// Starts API + web dev servers, picking a free API port (3001+) when the default is taken.
import net from "node:net";
import { spawn } from "node:child_process";

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
if (port !== DEFAULT_API_PORT) console.log(`[dev] port ${DEFAULT_API_PORT} busy, API will use ${port} (MCP: set APPLES_API_URL=http://127.0.0.1:${port})`);

const child = spawn(
  "npx",
  ["concurrently", "-n", "server,web", "-c", "blue,green", "npm run dev -w server", "npm run dev -w web"],
  { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, PORT: String(port), API_PORT: String(port) } },
);
child.on("exit", (code) => process.exit(code ?? 0));
