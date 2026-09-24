import { describe, it, expect, afterAll, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/db.js";
import type { Database } from "better-sqlite3";

describe("migrations", () => {
  it("creates all three tables with a singleton context row", () => {
    const db = openDb(":memory:");
    const tables = (db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[]).map((r) => r.name);
    expect(tables).toContain("companies");
    expect(tables).toContain("postings");
    expect(tables).toContain("context");

    const contextRows = db.prepare("SELECT COUNT(*) as count FROM context").get() as { count: number };
    expect(contextRows.count).toBe(1);
    db.close();
  });

  it("re-opening a temp-file db is idempotent (user_version = 2)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apples-db-test-"));
    const dbPath = path.join(dir, "test.db");
    let db: Database;

    try {
      db = openDb(dbPath);
      db.close();

      db = openDb(dbPath);
      const version = db.pragma("user_version", { simple: true }) as number;
      expect(version).toBe(2);
      const users = db.prepare("SELECT COUNT(*) as count FROM context").get() as { count: number };
      expect(users.count).toBe(1);
    } finally {
      db!.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
