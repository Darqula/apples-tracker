import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { registerErrorHandler } from "./errors.js";
import { registerOpenApi } from "./openapi.js";
import { registerCompanyRoutes } from "./routes/companies.js";
import { registerPostingRoutes } from "./routes/postings.js";
import { registerContextRoutes } from "./routes/context.js";
import { openDb, type Db } from "./db.js";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface BuildAppOptions {
  /** Directory of the built web app to serve at `/`. Skipped when unset or missing. */
  webDist?: string;
}

export function buildApp(db?: Db, options?: BuildAppOptions): FastifyInstance {
  const ownsDb = db === undefined;
  const database: Db = db ?? openDb();

  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
  });

  // Serve the built web app after all API routes so it can never shadow
  // /api/*, /docs or /openapi.json. Silently skipped when the directory does
  // not exist so tests and npm run dev are unaffected.
  const webDist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    options?.webDist ?? process.env.WEB_DIST ?? "../../web/dist",
  );

  // Hash routing: unknown non-API GET paths fall back to index.html, everything
  // else 404s with JSON for /api/* and empty for other methods.
  const webNotFoundHandler = (request: FastifyRequest, reply: FastifyReply) => {
    const isApiPath = request.raw.url?.startsWith("/api") ?? false;
    if (request.method === "GET" && !isApiPath) {
      return reply.status(200).type("text/html").send(fs.readFileSync(path.join(webDist, "index.html")));
    }

    reply.status(404);
    if (isApiPath) {
      return reply.send({
        error: { code: "NOT_FOUND", message: "Route not found" },
      });
    }
    return reply.send();
  };

  registerErrorHandler(app, fs.existsSync(webDist) ? { notFoundHandler: webNotFoundHandler } : undefined);

  // Must be queued before the routes: @fastify/swagger collects routes via an
  // onRoute hook installed when its plugin bootstraps (at app.ready()), so every
  // route registered inside a plugin queued AFTER it is included in the document.
  // registerOpenApi only queues plugins, so this call stays synchronous.
  registerOpenApi(app);

  // The API routes live in their own plugin so that @fastify/swagger
  // discovers them (see note above). Registering the handlers inside a plugin
  // changes no behavior: hooks and error handlers set on the root still apply.
  app.register(async (instance) => {
    registerCompanyRoutes(instance, database);
    registerPostingRoutes(instance, database);
    registerContextRoutes(instance, database);

    instance.get(
      "/api/health",
      {
        schema: {
          tags: ["Meta"],
          summary: "Health check",
          description: "Returns { ok: true } while the API is up.",
          response: {
            200: {
              type: "object",
              required: ["ok"],
              properties: {
                ok: { type: "boolean", description: "Always true while the API is running" },
              },
            },
          },
        },
      },
      async () => ({ ok: true }),
    );
  });

  if (ownsDb) {
    app.addHook("onClose", async () => {
      try {
        database.close();
      } catch {
        // already closed
      }
    });
  }

  if (fs.existsSync(webDist)) {
    app.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
    });
  } else {
    app.log.debug({ webDist }, "web dist directory not found; serving API only");
  }

  return app;
}
