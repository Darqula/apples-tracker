import fs from "node:fs";
import path from "node:path";
import { DEFAULT_DB_PATH } from "./config.js";

// The API may end up on a port other than the default (busy port fallback). The
// server records where it listens in a small file next to the database so the
// separately started MCP process can find it. The pid lets readers ignore a
// file left behind by a crashed server.

const PORT_FILE_NAME = ".api-port";

function portFilePath(dbPath: string): string | undefined {
  return dbPath === ":memory:" ? undefined : path.join(path.dirname(dbPath), PORT_FILE_NAME);
}

function currentDbPath(): string {
  return process.env.DB_PATH ?? DEFAULT_DB_PATH;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

interface PortFile {
  port: number;
  pid: number;
}

function readPortFile(file: string): PortFile | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<PortFile>;
    if (Number.isInteger(parsed.port) && Number.isInteger(parsed.pid)) return parsed as PortFile;
  } catch {
    // missing or unreadable: treat as absent
  }
  return undefined;
}

export function writeApiPort(port: number, dbPath = currentDbPath()): void {
  const file = portFilePath(dbPath);
  if (file === undefined) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ port, pid: process.pid }));
  } catch {
    // best effort: the API works without the file
  }
}

/** Removes the file, but only if this process wrote it. */
export function removeApiPort(dbPath = currentDbPath()): void {
  const file = portFilePath(dbPath);
  if (file === undefined) return;
  if (readPortFile(file)?.pid !== process.pid) return;
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // best effort
  }
}

/** The port of a running API server that uses the same database location, if any. */
export function readApiPort(dbPath = currentDbPath()): number | undefined {
  const file = portFilePath(dbPath);
  if (file === undefined) return undefined;
  const info = readPortFile(file);
  return info !== undefined && isAlive(info.pid) ? info.port : undefined;
}
