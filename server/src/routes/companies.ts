import type { FastifyInstance } from "fastify";
import { HttpError } from "../errors.js";
import { companyCreateSchema, idParamsSchema, companyPatchSchema, companyResponseSchema, companyDetailResponseSchema, companyListQuerySchema, companyDeleteQuerySchema, errorResponseSchema } from "../schemas.js";
import type { Db } from "../db.js";

interface CompanyRow {
  id: number;
  name: string;
  website: string | null;
  location: string | null;
  description: string;
  ai_context: string;
  urls: string;
  posting_count: number;
  created_at: string;
  updated_at: string;
}

interface CompanyBody {
  name?: string;
  website?: string | null;
  location?: string | null;
  description?: string;
  aiContext?: string;
  urls?: unknown[];
}

function toApiCompany(row: CompanyRow) {
  let urls: string[];
  try {
    const parsed = JSON.parse(row.urls) as unknown;
    urls = Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    urls = [];
  }
  return {
    id: row.id,
    name: row.name,
    website: row.website,
    location: row.location,
    description: row.description,
    aiContext: row.ai_context,
    urls,
    postingCount: row.posting_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => "\\" + c);
}

const COMPANY_SELECT = `SELECT id, name, website, location, description, ai_context, urls,
        (SELECT COUNT(*) FROM postings p WHERE p.company_id = companies.id) as posting_count,
        created_at, updated_at
 FROM companies`;

function getCompanyRow(db: Db, id: number): CompanyRow | undefined {
  return db.prepare(`${COMPANY_SELECT} WHERE id = ?`).get(id) as CompanyRow | undefined;
}

function noSuchCompany() {
  return new HttpError(404, "NOT_FOUND", "Company not found");
}

export function registerCompanyRoutes(app: FastifyInstance, db: Db) {
  app.get(
    "/api/companies",
    {
      schema: {
        tags: ["Companies"],
        summary: "List companies",
        description:
          "Returns a page of companies with their posting counts. " +
          "The `q` search matches only the company name (case-insensitive substring), never descriptions or AI context notes.",
        querystring: companyListQuerySchema,
        response: {
          200: {
            type: "object",
            properties: {
              items: { type: "array", items: companyResponseSchema },
              total: { type: "integer" },
            },
          },
          400: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { q, sort = "name", limit = 200, offset = 0 } = request.query as {
        q?: string;
        sort?: string;
        limit?: number;
        offset?: number;
      };

      let where = "";
      let params: unknown[] = [];

      if (q && q.length > 0) {
        where = " WHERE name LIKE ? ESCAPE '\\'";
        params = ["%" + escapeLike(q) + "%"];
      }

      const order =
        sort === "-name"
          ? "name COLLATE NOCASE DESC"
          : sort === "created"
            ? "created_at ASC"
            : sort === "-created"
              ? "created_at DESC"
              : "name COLLATE NOCASE ASC";

      const total = (
        db.prepare(`SELECT COUNT(*) as count FROM companies${where}`).get(...params) as { count: number }
      ).count;

      const rows = db
        .prepare(
          `${COMPANY_SELECT}${where}
           ORDER BY ${order}
           LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as unknown as CompanyRow[];

      return { items: rows.map(toApiCompany), total };
    },
  );

  app.get(
    "/api/companies/:id",
    {
      schema: {
        tags: ["Companies"],
        summary: "Get a company",
        description: "Returns one company by id, together with a short summary of its postings. Fails with 404 when the company does not exist.",
        params: idParamsSchema,
        response: {
          200: companyDetailResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: number };

      const row = getCompanyRow(db, id);

      if (!row) throw noSuchCompany();

      const postings = db
        .prepare(
          `SELECT id, title, state, applied_date
           FROM postings
           WHERE company_id = ?
           ORDER BY applied_date IS NULL ASC, applied_date DESC`,
        )
        .all(id) as unknown as { id: number; title: string; state: string; applied_date: string | null }[];

      return {
        ...toApiCompany(row),
        postings: postings.map((p) => ({
          id: p.id,
          title: p.title,
          state: p.state,
          appliedDate: p.applied_date,
        })),
      };
    },
  );

  app.post(
    "/api/companies",
    {
      schema: {
        tags: ["Companies"],
        summary: "Create a company",
        description: "Creates a company. Company names are unique (case-insensitive); a duplicate name fails with 409.",
        body: companyCreateSchema,
        response: {
          201: companyResponseSchema,
          400: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as CompanyBody;

      const name = body.name!.trim();
      if (name.length === 0) {
        throw new HttpError(400, "VALIDATION", "name must be a non-empty string");
      }

      const existing = db.prepare("SELECT id FROM companies WHERE name = ? COLLATE NOCASE").get(name);
      if (existing) {
        throw new HttpError(409, "CONFLICT", `Company with name '${name}' already exists`);
      }

      const result = db
        .prepare(
          `INSERT INTO companies (name, website, location, description, ai_context, urls)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          name,
          body.website ?? null,
          body.location ?? null,
          body.description ?? "",
          body.aiContext ?? "",
          JSON.stringify(body.urls ?? []),
        );

      const rec = getCompanyRow(db, Number(result.lastInsertRowid))!;

      return reply.status(201).send(toApiCompany(rec));
    },
  );

  app.patch(
    "/api/companies/:id",
    {
      schema: {
        tags: ["Companies"],
        summary: "Update a company",
        description: "Partially updates a company. Only the provided fields change; names stay unique (case-insensitive, 409 on duplicates). Fails with 404 for unknown ids.",
        params: idParamsSchema,
        body: companyPatchSchema,
        response: {
          200: companyResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: number };
      const body = request.body as CompanyBody;

      const existing = db.prepare("SELECT id FROM companies WHERE id = ?").get(id);
      if (!existing) throw noSuchCompany();

      const updates: string[] = [];
      const values: unknown[] = [];

      if (body.name !== undefined) {
        const name = body.name.trim();
        if (name.length === 0) {
          throw new HttpError(400, "VALIDATION", "name must be a non-empty string");
        }
        const dup = db
          .prepare("SELECT id FROM companies WHERE name = ? COLLATE NOCASE AND id != ?")
          .get(name, id);
        if (dup) {
          throw new HttpError(409, "CONFLICT", `Company with name '${name}' already exists`);
        }
        updates.push("name = ?");
        values.push(name);
      }

      for (const [key, column] of [
        ["website", "website"],
        ["location", "location"],
        ["description", "description"],
        ["aiContext", "ai_context"],
      ] as const) {
        if (body[key] !== undefined) {
          updates.push(`${column} = ?`);
          values.push(body[key]);
        }
      }

      if (body.urls !== undefined) {
        updates.push("urls = ?");
        values.push(JSON.stringify(body.urls));
      }

      updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
      values.push(id);

      db.prepare(`UPDATE companies SET ${updates.join(", ")} WHERE id = ?`).run(...values);

      const row = getCompanyRow(db, id)!;

      return toApiCompany(row);
    },
  );

  app.delete(
    "/api/companies/:id",
    {
      schema: {
        tags: ["Companies"],
        summary: "Delete a company",
        description:
          "Deletes a company. Unless `?cascade=true` is passed, the request fails with 409 when the company still has postings. Returns 204 with an empty body.",
        params: idParamsSchema,
        querystring: companyDeleteQuerySchema,
        response: {
          204: { type: "null" },
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: number };
      const cascade = (request.query as { cascade?: string }).cascade === "true";

      const existing = db.prepare("SELECT id FROM companies WHERE id = ?").get(id);
      if (!existing) throw noSuchCompany();

      const postingCount = (
        db.prepare("SELECT COUNT(*) as count FROM postings WHERE company_id = ?").get(id) as { count: number }
      ).count;

      if (postingCount > 0 && !cascade) {
        throw new HttpError(409, "CONFLICT", "Company has postings; use ?cascade=true to delete them too");
      }

      db.transaction(() => {
        db.prepare("DELETE FROM postings WHERE company_id = ?").run(id);
        db.prepare("DELETE FROM companies WHERE id = ?").run(id);
      })();

      return reply.status(204).send();
    },
  );
}
