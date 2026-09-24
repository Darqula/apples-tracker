import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sqlite, { type Database } from "better-sqlite3";

export type Db = Database;

function runMigrations(db: Db) {
  const migrationsDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "migrations",
  );

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const currentVersion = db.pragma("user_version", { simple: true }) as number;

  for (const file of files) {
    const version = Number(file.split("_")[0]);
    if (Number.isNaN(version) || version <= currentVersion) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    })();
  }
}

const DEFAULT_DB_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data/apples.db",
);

export function openDb(path_ = process.env.DB_PATH ?? DEFAULT_DB_PATH): Db {
  if (path_ !== ":memory:") {
    fs.mkdirSync(path.dirname(path_), { recursive: true });
  }

  const db = new sqlite(path_);

  if (path_ !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }

  db.pragma("foreign_keys = ON");

  runMigrations(db);

  return db;
}
