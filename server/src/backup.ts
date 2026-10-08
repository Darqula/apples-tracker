import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db.js";

export const BACKUP_DIR_NAME = "backups";
export const BACKUP_KEEP = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface BackupOptions {
  /** How many backups to retain; older ones are deleted. */
  keep?: number;
  now?: Date;
  /** Skip (returning null) when the newest backup is younger than this. */
  minAgeMs?: number;
}

function backupPattern(base: string): RegExp {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z\\.db$`);
}

/**
 * Writes a consistent snapshot of the database to `<db dir>/backups/` using
 * SQLite's online backup API (safe in WAL mode, unlike copying the file), then
 * prunes all but the newest `keep` backups. Returns the new backup's path, or
 * null for an in-memory database.
 */
export async function backupDb(db: Db, options: BackupOptions = {}): Promise<string | null> {
  if (db.memory) return null;

  const keep = options.keep ?? BACKUP_KEEP;
  const dbPath = db.name;
  const base = path.basename(dbPath, path.extname(dbPath));
  const dir = path.join(path.dirname(dbPath), BACKUP_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });

  const pattern = backupPattern(base);
  // Timestamps sort lexicographically in chronological order.
  const listBackups = () => fs.readdirSync(dir).filter((f) => pattern.test(f)).sort();

  const newest = listBackups().at(-1);
  if (newest && options.minAgeMs) {
    const age = Date.now() - fs.statSync(path.join(dir, newest)).mtimeMs;
    if (age < options.minAgeMs) return null;
  }

  const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const target = path.join(dir, `${base}-${stamp}.db`);

  // Write under a temp name so an interrupted backup never looks like a valid one.
  const partial = `${target}.partial`;
  try {
    await db.backup(partial);
    fs.renameSync(partial, target);
  } catch (err) {
    fs.rmSync(partial, { force: true });
    throw err;
  }

  const existing = listBackups();
  for (const old of existing.slice(0, Math.max(0, existing.length - keep))) {
    fs.rmSync(path.join(dir, old), { force: true });
  }

  return target;
}

// Dev restarts (tsx watch) must not rotate every older backup out.
const MIN_BACKUP_AGE_MS = 60 * 60 * 1000;

/** Backs up now, then once a day. Returns a function that stops the timer. */
export async function startBackups(
  db: Db,
  log: { info: (msg: string) => void; error: (err: unknown, msg: string) => void },
): Promise<() => void> {
  const run = async () => {
    try {
      const file = await backupDb(db, { minAgeMs: MIN_BACKUP_AGE_MS });
      if (file) log.info(`Database backed up to ${file}`);
    } catch (err) {
      log.error(err, "Database backup failed");
    }
  };

  await run();
  const timer = setInterval(() => void run(), DAY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
