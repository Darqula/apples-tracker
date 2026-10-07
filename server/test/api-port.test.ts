import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readApiPort, removeApiPort, writeApiPort } from "../src/api-port.js";
import { DEFAULT_API_BASE_URL, resolveApiBaseUrl } from "../src/mcp/api-client.js";

describe("api port file", () => {
  let dir: string;
  let dbPath: string;
  let portFile: string;
  const savedEnv = { DB_PATH: process.env.DB_PATH, APPLES_API_URL: process.env.APPLES_API_URL };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "apples-port-test-"));
    dbPath = path.join(dir, "apples.db");
    portFile = path.join(dir, ".api-port");
    delete process.env.APPLES_API_URL;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips the port of a live process", () => {
    writeApiPort(3005, dbPath);
    expect(readApiPort(dbPath)).toBe(3005);
  });

  it("returns nothing when there is no file", () => {
    expect(readApiPort(dbPath)).toBeUndefined();
  });

  it("ignores a file left behind by a dead process", () => {
    fs.writeFileSync(portFile, JSON.stringify({ port: 3005, pid: 2 ** 22 + 12345 }));
    expect(readApiPort(dbPath)).toBeUndefined();
  });

  it("ignores a corrupt file", () => {
    fs.writeFileSync(portFile, "not json");
    expect(readApiPort(dbPath)).toBeUndefined();
  });

  it("removes the file only when this process wrote it", () => {
    fs.writeFileSync(portFile, JSON.stringify({ port: 3005, pid: process.pid + 1 }));
    removeApiPort(dbPath);
    expect(fs.existsSync(portFile)).toBe(true);

    writeApiPort(3005, dbPath);
    removeApiPort(dbPath);
    expect(fs.existsSync(portFile)).toBe(false);
  });

  it("does nothing for an in-memory database", () => {
    writeApiPort(3005, ":memory:");
    expect(readApiPort(":memory:")).toBeUndefined();
  });

  it("resolveApiBaseUrl: APPLES_API_URL wins, then the port file, then the default", () => {
    process.env.DB_PATH = dbPath;
    expect(resolveApiBaseUrl()).toBe(DEFAULT_API_BASE_URL);

    writeApiPort(3007, dbPath);
    expect(resolveApiBaseUrl()).toBe("http://127.0.0.1:3007");

    process.env.APPLES_API_URL = "http://example.test:9";
    expect(resolveApiBaseUrl()).toBe("http://example.test:9");
  });
});
