import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sqlite from "better-sqlite3";
import { openDb, type Db } from "../src/db.js";
import { backupDb } from "../src/backup.js";

describe("backupDb", () => {
  let dir: string;
  let db: Db;
  let backupsDir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "apples-backup-test-"));
    db = openDb(path.join(dir, "test.db"));
    backupsDir = path.join(dir, "backups");
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes a restorable snapshot into backups/ next to the db", async () => {
    db.prepare("UPDATE context SET content = 'hello backup'").run();

    const file = await backupDb(db);

    expect(file).not.toBeNull();
    expect(path.dirname(file!)).toBe(backupsDir);
    const copy = new sqlite(file!, { readonly: true });
    try {
      expect(copy.prepare("SELECT content FROM context").get()).toEqual({ content: "hello backup" });
    } finally {
      copy.close();
    }
    expect(fs.readdirSync(backupsDir).filter((f) => f.endsWith(".partial"))).toEqual([]);
  });

  it("keeps only the newest N backups", async () => {
    for (let i = 0; i < 5; i++) {
      await backupDb(db, { keep: 3, now: new Date(Date.UTC(2026, 0, 1 + i)) });
    }

    expect(fs.readdirSync(backupsDir).sort()).toEqual([
      "test-2026-01-03T00-00-00-000Z.db",
      "test-2026-01-04T00-00-00-000Z.db",
      "test-2026-01-05T00-00-00-000Z.db",
    ]);
  });

  it("skips when the newest backup is younger than minAgeMs", async () => {
    expect(await backupDb(db, { minAgeMs: 60_000 })).not.toBeNull();
    expect(await backupDb(db, { minAgeMs: 60_000, now: new Date(Date.now() + 1000) })).toBeNull();
    expect(fs.readdirSync(backupsDir)).toHaveLength(1);
  });

  it("does nothing for an in-memory database", async () => {
    const mem = openDb(":memory:");
    try {
      expect(await backupDb(mem)).toBeNull();
    } finally {
      mem.close();
    }
  });
});
