import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpError } from "../errors.js";
import {
  contextResponseSchema,
  contextPutBodySchema,
  contextHistoryListResponseSchema,
  contextHistoryEntrySchema,
  contextHistoryParamsSchema,
  errorResponseSchema,
} from "../schemas.js";
import type { Db } from "../db.js";

export const MAX_CONTEXT_HISTORY = 50;
// A write is refused when it shrinks a note of at least MIN_LENGTH characters
// below RATIO of its current length (unless forced): the typical failure mode
// of a model rewriting the note from a truncated read.
export const SHRINK_GUARD_MIN_LENGTH = 200;
export const SHRINK_GUARD_RATIO = 0.5;

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
          "Replaces the content of the shared context note. `expectedUpdatedAt` is required: pass the previously read " +
          "`updatedAt` value; the write fails with 409 when the note changed in the meantime. " +
          "A write that cuts a note of 200+ characters to under half its length is refused with 422 SHRINK_GUARD " +
          "unless `force` is true. The overwritten content is kept in the version history.",
        body: contextPutBodySchema,
        response: {
          200: contextResponseSchema,
          400: errorResponseSchema,
          409: errorResponseSchema,
          422: errorResponseSchema,
        },
      },
      // Fastify's ajv coerces types (null -> "", "true" -> true), which would turn a
      // malformed call into a valid write or a forced one. Check the raw body first.
      preValidation: async (request) => {
        const body = request.body as Record<string, unknown> | null | undefined;
        if (body === null || typeof body !== "object") return; // schema reports it
        const bad = (key: string, type: string) => key in body && typeof body[key] !== type;
        if (bad("content", "string") || bad("expectedUpdatedAt", "string") || bad("force", "boolean")) {
          throw new HttpError(
            400,
            "VALIDATION",
            "content and expectedUpdatedAt must be strings and force a boolean",
          );
        }
      },
    },
    async (request) => {
      const body = request.body as { content: string; expectedUpdatedAt: string; force?: boolean };

      // Check and write in one transaction so the guards cannot be raced.
      db.transaction(() => {
        const row = getContextRow(db);

        if (body.expectedUpdatedAt !== row.updated_at) {
          throw new HttpError(409, "CONFLICT", "context changed since it was loaded");
        }

        const oldLength = row.content.length;
        const newLength = body.content.length;
        const wipesNote = oldLength > 0 && newLength === 0;
        if (
          body.force !== true &&
          (wipesNote || (oldLength >= SHRINK_GUARD_MIN_LENGTH && newLength < oldLength * SHRINK_GUARD_RATIO))
        ) {
          throw new HttpError(
            422,
            "SHRINK_GUARD",
            wipesNote
              ? `The new content is empty but the current note has ${oldLength} chars. ` +
                  "Resend with force=true only if erasing the note is intended."
              : `The new content (${newLength} chars) is less than ${SHRINK_GUARD_RATIO * 100}% of the current note ` +
                  `(${oldLength} chars). Resend with force=true only if this reduction is intended.`,
          );
        }

        if (row.content !== "" && row.content !== body.content) {
          db.prepare("INSERT INTO context_history (content, version_updated_at) VALUES (?, ?)").run(
            row.content,
            row.updated_at,
          );
          db.prepare(
            `DELETE FROM context_history
             WHERE id NOT IN (SELECT id FROM context_history ORDER BY id DESC LIMIT ?)`,
          ).run(MAX_CONTEXT_HISTORY);
        }

        db.prepare(
          `UPDATE context
           SET content = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE id = 1`,
        ).run(body.content);
      }).immediate();

      return toApiContext(getContextRow(db));
    },
  );

  app.get(
    "/api/context/history",
    {
      schema: {
        tags: ["Context"],
        summary: "List earlier versions of the shared context note",
        description:
          `Every overwrite keeps the previous content; the newest ${MAX_CONTEXT_HISTORY} versions are retained. ` +
          "Returns metadata only, newest first. To restore a version, read it and PUT its content to /api/context.",
        response: {
          200: contextHistoryListResponseSchema,
        },
      },
    },
    async () => {
      const rows = db
        .prepare(
          `SELECT id, version_updated_at, replaced_at, length(content) AS length
           FROM context_history ORDER BY id DESC`,
        )
        .all() as { id: number; version_updated_at: string; replaced_at: string; length: number }[];
      return {
        items: rows.map((r) => ({
          id: r.id,
          updatedAt: r.version_updated_at,
          replacedAt: r.replaced_at,
          length: r.length,
        })),
      };
    },
  );

  app.get(
    "/api/context/history/:id",
    {
      schema: {
        tags: ["Context"],
        summary: "Get one earlier version of the shared context note",
        params: contextHistoryParamsSchema,
        response: {
          200: contextHistoryEntrySchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: number };
      const row = db
        .prepare("SELECT id, content, version_updated_at, replaced_at FROM context_history WHERE id = ?")
        .get(id) as
        | { id: number; content: string; version_updated_at: string; replaced_at: string }
        | undefined;
      if (row === undefined) {
        throw new HttpError(404, "NOT_FOUND", "context version not found");
      }
      return {
        id: row.id,
        content: row.content,
        updatedAt: row.version_updated_at,
        replacedAt: row.replaced_at,
      };
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
