import { describe, it, expect, afterAll, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

  it("re-opening a temp-file db is idempotent (user_version = 4)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apples-db-test-"));
    const dbPath = path.join(dir, "test.db");
    let db: Database;

    try {
      db = openDb(dbPath);
      db.close();

      db = openDb(dbPath);
      const version = db.pragma("user_version", { simple: true }) as number;
      expect(version).toBe(4);
      const users = db.prepare("SELECT COUNT(*) as count FROM context").get() as { count: number };
      expect(users.count).toBe(1);
    } finally {
      db!.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("has unique, gap-free migration numbers (a duplicate would be skipped on existing databases)", () => {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/migrations");
    const numbers = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => Number(f.split("_")[0]))
      .sort((a, b) => a - b);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it("upgrades a database that is already at user_version 3", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apples-db-test-"));
    const dbPath = path.join(dir, "test.db");
    let db: Database | undefined;

    try {
      db = openDb(dbPath);
      db.exec("DROP TABLE context_history");
      db.pragma("user_version = 3");
      db.close();

      db = openDb(dbPath);
      expect(db.prepare("SELECT COUNT(*) as count FROM context_history").get()).toEqual({ count: 0 });
    } finally {
      db?.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
