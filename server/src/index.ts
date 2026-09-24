import { buildApp } from "./app.js";

const app = buildApp();

const port = Number(process.env.PORT ?? 3001);

const address = await app.listen({ host: "127.0.0.1", port }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

app.log.info(`Apples Tracker running at ${address}`);
