import { buildApp } from "./app.js";
import type { AddressInfo } from "node:net";
import { removeApiPort, writeApiPort } from "./api-port.js";
import { DEFAULT_HOST, DEFAULT_PORT } from "./config.js";

const app = buildApp();

const MAX_PORT_ATTEMPTS = 20;

// An explicit PORT is strict; without it, fall through to the next free port.
const explicitPort = process.env.PORT !== undefined;
const firstPort = Number(process.env.PORT ?? DEFAULT_PORT);
const attempts = explicitPort ? 1 : MAX_PORT_ATTEMPTS;

let address: string | undefined;
for (let i = 0; i < attempts; i++) {
  try {
    address = await app.listen({ host: DEFAULT_HOST, port: firstPort + i });
    break;
  } catch (err) {
    const inUse = (err as NodeJS.ErrnoException).code === "EADDRINUSE";
    if (!inUse || i === attempts - 1) {
      app.log.error(err);
      process.exit(1);
    }
    app.log.warn(`Port ${firstPort + i} in use, trying ${firstPort + i + 1}`);
  }
}

// Tell the MCP process (and anyone else on this machine) where the API really is.
writeApiPort((app.server.address() as AddressInfo).port);
process.on("exit", () => removeApiPort());
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void app.close().finally(() => process.exit(0)));
}

app.log.info(`Apples Tracker running at ${address}`);
