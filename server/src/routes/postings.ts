import type { FastifyInstance } from "fastify";
import { HttpError } from "../errors.js";
import {
  postingCreateSchema,
  postingPatchSchema,
  postingResponseSchema,
  postingListQuerySchema,
  idParamsSchema,
  errorResponseSchema,
  STAGE_ORDER,
} from "../schemas.js";
import type { Db } from "../db.js";

interface PostingRow {
  id: number;
  company_id: number;
  company_name: string;
  title: string;
  state: string;
  applied_date: string | null;
  description: string;
  ai_context: string;
  urls: string;
  created_at: string;
  updated_at: string;
}

interface PostingBody {
  companyId?: number;
  companyName?: string;
  title?: string;
  state?: string;
  appliedDate?: string | null;
  description?: string;
  aiContext?: string;
  urls?: unknown[];
}

function toApiPosting(row: PostingRow) {
  let urls: string[];
  try {
    const parsed = JSON.parse(row.urls) as unknown;
    urls = Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    urls = [];
  }
  return {
    id: row.id,
    companyId: row.company_id,
    company: { id: row.company_id, name: row.company_name },
    title: row.title,
    state: row.state,
    appliedDate: row.applied_date,
    description: row.description,
    aiContext: row.ai_context,
    urls,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => "\\" + c);
}

const POSTING_SELECT = `SELECT postings.id, postings.company_id, companies.name as company_name,
        postings.title, postings.state, postings.applied_date, postings.description,
        postings.ai_context, postings.urls, postings.created_at, postings.updated_at
 FROM postings
 JOIN companies ON companies.id = postings.company_id`;

function getPostingRow(db: Db, id: number): PostingRow | undefined {
  return db.prepare(`${POSTING_SELECT} WHERE postings.id = ?`).get(id) as PostingRow | undefined;
}

function noSuchPosting() {
  return new HttpError(404, "NOT_FOUND", "Posting not found");
}

function noSuchCompany() {
  return new HttpError(404, "NOT_FOUND", "Company not found");
}

const STAGE_CASE = `CASE state ${STAGE_ORDER.map((s, i) => `WHEN '${s}' THEN ${i}`).join(" ")} ELSE ${STAGE_ORDER.length} END`;

const TIEBREAKERS = `applied_date IS NULL ASC, applied_date DESC, title COLLATE NOCASE ASC, postings.id`;

export function registerPostingRoutes(app: FastifyInstance, db: Db) {
  app.get(
    "/api/postings",
    {
      schema: {
        tags: ["Postings"],
        summary: "List postings",
        description:
          "Returns a page of postings, filterable and sortable. " +
          "The `q` search matches only the job title and the company name (case-insensitive substrings) — never the description or AI context notes.",
        querystring: postingListQuerySchema,
        response: {
          200: {
            type: "object",
            properties: {
              items: { type: "array", items: postingResponseSchema },
              total: { type: "integer" },
            },
          },
          400: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const {
        q,
        state,
        companyId,
        sort = "stage",
        limit = 500,
        offset = 0,
      } = request.query as {
        q?: string;
        state?: string;
        companyId?: number;
        sort?: string;
        limit?: number;
        offset?: number;
      };

      const conditions: string[] = [];
      let params: unknown[] = [];

      if (q && q.length > 0) {
        conditions.push("(postings.title LIKE ? ESCAPE '\\' OR companies.name LIKE ? ESCAPE '\\')");
        params.push("%" + escapeLike(q) + "%", "%" + escapeLike(q) + "%");
      }
      if (state !== undefined) {
        conditions.push("postings.state = ?");
        params.push(state);
      }
      if (companyId !== undefined) {
        conditions.push("postings.company_id = ?");
        params.push(companyId);
      }

      const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";

      const order =
        sort === "company"
          ? `companies.name COLLATE NOCASE ASC, ${TIEBREAKERS}`
          : sort === "applied"
            ? `applied_date IS NULL ASC, applied_date DESC, ${TIEBREAKERS}`
            : sort === "-applied"
              ? `applied_date IS NULL ASC, applied_date ASC, ${TIEBREAKERS}`
              : sort === "title"
                ? `title COLLATE NOCASE ASC, ${TIEBREAKERS}`
                : sort === "updated"
                  ? `postings.updated_at DESC, ${TIEBREAKERS}`
                  : `${STAGE_CASE} ASC, ${TIEBREAKERS}`;

      const total = (
        db
          .prepare(`SELECT COUNT(*) as count FROM postings JOIN companies ON companies.id = postings.company_id${where}`)
          .get(...params) as { count: number }
      ).count;

      const rows = db
        .prepare(`${POSTING_SELECT}${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
        .all(...params, limit, offset) as unknown as PostingRow[];

      return { items: rows.map(toApiPosting), total };
    },
  );

  app.get(
    "/api/postings/:id",
    {
      schema: {
        tags: ["Postings"],
        summary: "Get a posting",
        description: "Returns one posting by id, including its fields for the company. Fails with 404 when the posting does not exist.",
        params: idParamsSchema,
        response: {
          200: postingResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: number };

      const row = getPostingRow(db, id);
      if (!row) throw noSuchPosting();

      return toApiPosting(row);
    },
  );

  app.post(
    "/api/postings",
    {
      schema: {
        tags: ["Postings"],
        summary: "Create a posting",
        description:
          "Creates a posting. Either an existing `companyId` or a `companyName` must be given (exactly one); " +
          "a `companyName` that does not exist yet is created on the fly. Unknown `companyId` fails with 404.",
        body: postingCreateSchema,
        response: {
          201: postingResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as PostingBody;
      const state = body.state ?? "saved";

      let companyId: number | undefined;

      if (body.companyId !== undefined) {
        const company = db.prepare("SELECT id FROM companies WHERE id = ?").get(body.companyId);
        if (!company) throw noSuchCompany();
        companyId = body.companyId;
      } else {
        const name = body.companyName!.trim();
        companyId = db.transaction(() => {
          const existing = db.prepare("SELECT id FROM companies WHERE name = ? COLLATE NOCASE").get(name) as
            | { id: number }
            | undefined;
          if (existing) return existing.id;
          const created = db
            .prepare(
              `INSERT INTO companies (name, description, ai_context) VALUES (?, ?, ?)`,
            )
            .run(name, "", "");
          return Number(created.lastInsertRowid);
        })();
      }

      const result = db
        .prepare(
          `INSERT INTO postings (company_id, title, state, applied_date, description, ai_context, urls)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          companyId,
          body.title,
          state,
          body.appliedDate ?? null,
          body.description ?? "",
          body.aiContext ?? "",
          JSON.stringify(body.urls ?? []),
        );

      const row = getPostingRow(db, Number(result.lastInsertRowid))!;

      return reply.status(201).send(toApiPosting(row));
    },
  );

  app.patch(
    "/api/postings/:id",
    {
      schema: {
        tags: ["Postings"],
        summary: "Update a posting",
        description:
          "Partially updates a posting: title, state, dates, links, notes or the referenced company. Fails with 404 for an unknown posting id or company id.",
        params: idParamsSchema,
        body: postingPatchSchema,
        response: {
          200: postingResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: number };
      const body = request.body as PostingBody;

      const existing = db.prepare("SELECT id FROM postings WHERE id = ?").get(id);
      if (!existing) throw noSuchPosting();

      if (body.companyId !== undefined) {
        const company = db.prepare("SELECT id FROM companies WHERE id = ?").get(body.companyId);
        if (!company) throw noSuchCompany();
      }

      const updates: string[] = [];
      const values: unknown[] = [];

      for (const [key, column] of [
        ["title", "title"],
        ["state", "state"],
        ["description", "description"],
        ["aiContext", "ai_context"],
      ] as const) {
        if (body[key] !== undefined) {
          updates.push(`${column} = ?`);
          values.push(body[key]);
        }
      }

      if (body.appliedDate !== undefined) {
        updates.push("applied_date = ?");
        values.push(body.appliedDate);
      }

      if (body.urls !== undefined) {
        updates.push("urls = ?");
        values.push(JSON.stringify(body.urls));
      }

      if (body.companyId !== undefined) {
        updates.push("company_id = ?");
        values.push(body.companyId);
      }

      updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
      values.push(id);

      db.prepare(`UPDATE postings SET ${updates.join(", ")} WHERE id = ?`).run(...values);

      const row = getPostingRow(db, id)!;

      return toApiPosting(row);
    },
  );

  app.delete(
    "/api/postings/:id",
    {
      schema: {
        tags: ["Postings"],
        summary: "Delete a posting",
        description: "Deletes a posting. Returns 204 with an empty body. Fails with 404 for unknown ids.",
        params: idParamsSchema,
        response: {
          204: { type: "null" },
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: number };

      const existing = db.prepare("SELECT id FROM postings WHERE id = ?").get(id);
      if (!existing) throw noSuchPosting();

      db.prepare("DELETE FROM postings WHERE id = ?").run(id);

      return reply.status(204).send();
    },
  );
}
