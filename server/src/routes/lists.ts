import type { FastifyInstance } from "fastify";
import { HttpError } from "../errors.js";
import { errorResponseSchema, idParamsSchema, listCreateSchema, listResponseSchema } from "../schemas.js";
import type { Db } from "../db.js";

export type ListKind = "company" | "posting";

interface KindConfig {
  path: string;
  tag: string;
  label: string;
  lists: string;
  members: string;
  itemColumn: string;
}

const KINDS: Record<ListKind, KindConfig> = {
  company: {
    path: "/api/company-lists",
    tag: "Companies",
    label: "company",
    lists: "company_lists",
    members: "company_list_members",
    itemColumn: "company_id",
  },
  posting: {
    path: "/api/posting-lists",
    tag: "Postings",
    label: "posting",
    lists: "posting_lists",
    members: "posting_list_members",
    itemColumn: "posting_id",
  },
};

export interface ListRef {
  id: number;
  name: string;
}

interface ListRow {
  id: number;
  name: string;
  member_count: number;
  created_at: string;
}

function toApiList(row: ListRow) {
  return { id: row.id, name: row.name, memberCount: row.member_count, createdAt: row.created_at };
}

function noSuchList() {
  return new HttpError(404, "NOT_FOUND", "List not found");
}

/** SQL fragment restricting `column` (an item id) to members of one list. Takes one parameter: the list id. */
export function memberFilterSql(kind: ListKind, column: string): string {
  const cfg = KINDS[kind];
  return `${column} IN (SELECT ${cfg.itemColumn} FROM ${cfg.members} WHERE list_id = ?)`;
}

/** The lists each of `itemIds` belongs to (sorted by name); items without lists are absent from the map. One query. */
export function loadListsFor(db: Db, kind: ListKind, itemIds: number[]): Map<number, ListRef[]> {
  const result = new Map<number, ListRef[]>();
  if (itemIds.length === 0) return result;
  const cfg = KINDS[kind];
  const rows = db
    .prepare(
      `SELECT m.${cfg.itemColumn} AS item_id, l.id, l.name
       FROM ${cfg.members} m JOIN ${cfg.lists} l ON l.id = m.list_id
       WHERE m.${cfg.itemColumn} IN (${itemIds.map(() => "?").join(",")})
       ORDER BY l.name COLLATE NOCASE ASC, l.id`,
    )
    .all(...itemIds) as { item_id: number; id: number; name: string }[];
  for (const row of rows) {
    const list = result.get(row.item_id) ?? [];
    list.push({ id: row.id, name: row.name });
    result.set(row.item_id, list);
  }
  return result;
}

/**
 * Replaces the memberships of one item. Throws 404 before writing anything when a list id is unknown,
 * so call it inside the same transaction as the item write.
 */
export function setMemberships(db: Db, kind: ListKind, itemId: number, listIds: number[]): void {
  const cfg = KINDS[kind];
  const unique = [...new Set(listIds)];
  const exists = db.prepare(`SELECT 1 FROM ${cfg.lists} WHERE id = ?`);
  for (const id of unique) {
    if (!exists.get(id)) throw noSuchList();
  }
  db.prepare(`DELETE FROM ${cfg.members} WHERE ${cfg.itemColumn} = ?`).run(itemId);
  const insert = db.prepare(`INSERT INTO ${cfg.members} (list_id, ${cfg.itemColumn}) VALUES (?, ?)`);
  for (const id of unique) insert.run(id, itemId);
}

function registerKind(app: FastifyInstance, db: Db, kind: ListKind) {
  const cfg = KINDS[kind];

  const LIST_SELECT = `SELECT l.id, l.name, l.created_at,
        (SELECT COUNT(*) FROM ${cfg.members} m WHERE m.list_id = l.id) AS member_count
 FROM ${cfg.lists} l`;

  const getRow = (id: number) => db.prepare(`${LIST_SELECT} WHERE l.id = ?`).get(id) as ListRow | undefined;

  const checkName = (raw: string, exceptId?: number): string => {
    const name = raw.trim();
    if (name.length === 0) throw new HttpError(400, "VALIDATION", "name must be a non-empty string");
    const dup = db
      .prepare(`SELECT id FROM ${cfg.lists} WHERE name = ? COLLATE NOCASE AND id IS NOT ?`)
      .get(name, exceptId ?? null);
    if (dup) throw new HttpError(409, "CONFLICT", `A ${cfg.label} list named '${name}' already exists`);
    return name;
  };

  app.get(
    cfg.path,
    {
      schema: {
        tags: [cfg.tag],
        summary: `List ${cfg.label} lists`,
        description: `Returns all ${cfg.label} lists (user-defined named groups), sorted by name, with their member counts.`,
        response: {
          200: {
            type: "object",
            properties: { items: { type: "array", items: listResponseSchema }, total: { type: "integer" } },
          },
        },
      },
    },
    async () => {
      const rows = db.prepare(`${LIST_SELECT} ORDER BY l.name COLLATE NOCASE ASC`).all() as unknown as ListRow[];
      return { items: rows.map(toApiList), total: rows.length };
    },
  );

  app.post(
    cfg.path,
    {
      schema: {
        tags: [cfg.tag],
        summary: `Create a ${cfg.label} list`,
        description: `Creates an empty ${cfg.label} list. Names are unique among ${cfg.label} lists (case-insensitive); a duplicate fails with 409.`,
        body: listCreateSchema,
        response: { 201: listResponseSchema, 400: errorResponseSchema, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const name = checkName((request.body as { name: string }).name);
      const result = db.prepare(`INSERT INTO ${cfg.lists} (name) VALUES (?)`).run(name);
      return reply.status(201).send(toApiList(getRow(Number(result.lastInsertRowid))!));
    },
  );

  app.patch(
    `${cfg.path}/:id`,
    {
      schema: {
        tags: [cfg.tag],
        summary: `Rename a ${cfg.label} list`,
        description: "Renames a list. Names stay unique (case-insensitive, 409 on duplicates). Fails with 404 for unknown ids.",
        params: idParamsSchema,
        body: listCreateSchema,
        response: { 200: listResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema },
      },
    },
    async (request) => {
      const { id } = request.params as { id: number };
      if (!getRow(id)) throw noSuchList();
      const name = checkName((request.body as { name: string }).name, id);
      db.prepare(`UPDATE ${cfg.lists} SET name = ? WHERE id = ?`).run(name, id);
      return toApiList(getRow(id)!);
    },
  );

  app.delete(
    `${cfg.path}/:id`,
    {
      schema: {
        tags: [cfg.tag],
        summary: `Delete a ${cfg.label} list`,
        description: `Deletes a list. The ${cfg.label}s in it are not affected, they are only removed from the list. Returns 204. Fails with 404 for unknown ids.`,
        params: idParamsSchema,
        response: { 204: { type: "null" }, 400: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: number };
      if (!getRow(id)) throw noSuchList();
      db.prepare(`DELETE FROM ${cfg.lists} WHERE id = ?`).run(id);
      return reply.status(204).send();
    },
  );
}

export function registerListRoutes(app: FastifyInstance, db: Db) {
  registerKind(app, db, "company");
  registerKind(app, db, "posting");
}
