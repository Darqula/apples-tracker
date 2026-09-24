import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { seedDatabase } from "../src/seed.js";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";

describe("seedDatabase", () => {
  let db: Database;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = openDb(":memory:");
    const result = seedDatabase(db, new Date("2026-09-24T12:00:00Z"));
    expect(result.companies).toBeGreaterThanOrEqual(6);
    expect(result.postings).toBeGreaterThanOrEqual(12);

    app = buildApp(db);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  it("covers all eight states", () => {
    const states = db.prepare("SELECT DISTINCT state FROM postings").all() as { state: string }[];
    expect(new Set(states.map((s) => s.state))).toEqual(
      new Set(["saved", "applied", "screening", "interview", "offer", "rejected", "withdrawn", "ghosted"]),
    );
  });

  it("gives every posting an existing company", () => {
    const orphans = db
      .prepare(
        "SELECT COUNT(*) as count FROM postings LEFT JOIN companies ON companies.id = postings.company_id WHERE companies.id IS NULL",
      )
      .get() as { count: number };
    expect(orphans.count).toBe(0);
  });

  it("sets a non-empty context note", () => {
    const row = db.prepare("SELECT content FROM context WHERE id = 1").get() as { content: string };
    expect(row.content.trim().length).toBeGreaterThan(0);
  });

  it("serves postings ordered by stage through the REST app", async () => {
    const res = await app.inject({ method: "GET", url: "/api/postings?sort=stage" });
    expect(res.statusCode).toBe(200);

    const { items, total } = res.json();
    expect(total).toBeGreaterThanOrEqual(12);

    const stageOrder = ["offer", "interview", "screening", "applied", "saved", "rejected", "withdrawn", "ghosted"];
    const indices = items.map((item: { state: string }) => stageOrder.indexOf(item.state));
    const sorted = [...indices].sort((a, b) => a - b);
    expect(indices).toEqual(sorted);
  });
});
