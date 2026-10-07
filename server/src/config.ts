import path from "node:path";
import { fileURLToPath } from "node:url";

// Keep in sync with scripts/ports.mjs (dev tooling lives outside this package).
export const DEFAULT_PORT = 3001;
export const DEFAULT_HOST = "127.0.0.1";

export const DEFAULT_DB_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data/apples.db",
);
