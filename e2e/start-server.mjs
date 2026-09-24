// Starts the built app on PORT (default 3070) with a fresh seeded temp DB.
// Used as the Playwright webServer command; cross-platform, no bash syntax.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = process.env.DB_PATH ?? path.join(root, "e2e", ".tmp", "e2e.db");
const port = process.env.PORT ?? "3070";

// Wipe the DB (plus SQLite sidecar files) and create the folder.
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) {
  try {
    fs.rmSync(dbPath + suffix, { force: true });
  } catch {
    // ignore — file may not exist
  }
}

// Seed synchronously (server/src/seed.ts exits 1 unless the DB is empty).
execFileSync("npm", ["run", "seed", "--silent"], {
  cwd: root,
  shell: process.platform === "win32",
  stdio: "inherit",
  env: { ...process.env, DB_PATH: dbPath },
});

// Start the built app; the UI dist is served from web/dist by server/dist/index.js.
const child = spawn("node", [path.join(root, "server", "dist", "index.js")], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: port,
    DB_PATH: dbPath,
    HOST: "127.0.0.1",
  },
});

const killChild = () => {
  if (!child.killed) child.kill();
};

process.on("SIGTERM", killChild);
process.on("SIGINT", killChild);
process.on("exit", killChild);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
