import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpError } from "../errors.js";
import { contextResponseSchema, contextPutBodySchema, errorResponseSchema } from "../schemas.js";
import type { Db } from "../db.js";

interface ContextRow {
  content: string;
  updated_at: string;
}

function getContextRow(db: Db): ContextRow {
  return db.prepare("SELECT content, updated_at FROM context WHERE id = 1").get() as ContextRow;
}

function toApiContext(row: ContextRow) {
  return {
    content: row.content,
    updatedAt: row.updated_at,
  };
}

export function readAiGuide() {
  const guidePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "ai-guide.md",
  );
  return fs.readFileSync(guidePath, "utf8");
}

export function registerContextRoutes(app: FastifyInstance, db: Db) {
  app.get(
    "/api/context",
    {
      schema: {
        tags: ["Context"],
        summary: "Get the shared context note",
        description: "Returns the one shared context note together with its last update time. This note is what AI models are meant to read.",
        response: {
          200: contextResponseSchema,
        },
      },
    },
    async () => {
      return toApiContext(getContextRow(db));
    },
  );

  app.put(
    "/api/context",
    {
      schema: {
        tags: ["Context"],
        summary: "Replace the shared context note",
        description:
          "Replaces the content of the shared context note. Pass the previously read `updatedAt` value as `expectedUpdatedAt` " +
          "to fail with 409 when the note changed in the meantime.",
        body: contextPutBodySchema,
        response: {
          200: contextResponseSchema,
          400: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const body = request.body as { content: string; expectedUpdatedAt?: string };

      const row = getContextRow(db);

      if (body.expectedUpdatedAt !== undefined && body.expectedUpdatedAt !== row.updated_at) {
        throw new HttpError(409, "CONFLICT", "context changed since it was loaded");
      }

      db.prepare(
        `UPDATE context
         SET content = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = 1`,
      ).run(body.content);

      return toApiContext(getContextRow(db));
    },
  );

  app.get(
    "/api/guide",
    {
      schema: {
        tags: ["Meta"],
        summary: "Get the AI usage guide",
        description: "Returns a usage guide for AI tools/consumers of this API as Markdown (content type text/markdown).",
      },
    },
    async (_request, reply) => {
      return reply
        .status(200)
        .type("text/markdown; charset=utf-8")
        .send(readAiGuide());
    },
  );
}
