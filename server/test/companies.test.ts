import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";

describe("companies routes", () => {
  let db: Database;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = openDb(":memory:");
    app = buildApp(db);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  const post = async (payload: object) =>
    app.inject({
      method: "POST",
      url: "/api/companies",
      payload,
    });

  it("creates and gets a company with urls array, defaults and camelCase", async () => {
    const res = await post({
      name: "  Acme Corp  ",
      website: "https://acme.example",
      urls: ["https://jobs.example/acme"],
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created.name).toBe("Acme Corp");
    expect(created.website).toBe("https://acme.example");
    expect(created.description).toBe("");
    expect(created.aiContext).toBe("");
    expect(created.urls).toEqual(["https://jobs.example/acme"]);
    expect(created.postingCount).toBe(0);
    expect(typeof created.createdAt).toBe("string");
    expect(typeof created.updatedAt).toBe("string");

    const got = await app.inject({ method: "GET", url: `/api/companies/${created.id}` });
    expect(got.statusCode).toBe(200);
    const company = got.json();
    expect(company.id).toBe(created.id);
    expect(company.aiContext).toBe("");
    expect(company.postings).toEqual([]);
  });

  it("returns 400 when name is missing", async () => {
    const res = await post({ website: "https://x.example" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("returns 400 for a bad url scheme", async () => {
    const res = await post({ name: "URLless", urls: ["ftp://example.com"] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("returns 409 for a duplicate name differing only in case", async () => {
    const first = await post({ name: "DupCo" });
    expect(first.statusCode).toBe(201);
    const second = await post({ name: "dupco" });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("CONFLICT");
  });

  it("list q matches name substring case-insensitively, not description", async () => {
    await post({ name: "SearchableCorp", description: "matching description text" });
    await post({ name: "OtherCorp", description: "needle-in-description" });

    const byName = await app.inject({ method: "GET", url: "/api/companies?q=searchable" });
    expect(byName.statusCode).toBe(200);
    expect(byName.json().items.map((c: { name: string }) => c.name)).toEqual(["SearchableCorp"]);

    const notDesc = await app.inject({ method: "GET", url: "/api/companies?q=needle" });
    expect(notDesc.json().total).toBe(0);
  });

  it("list sortBy name and -name", async () => {
    await app.inject({ method: "POST", url: "/api/companies", payload: { name: "Beta Ltd" } });
    await app.inject({ method: "POST", url: "/api/companies", payload: { name: "alpha inc" } });

    const asc = await app.inject({ method: "GET", url: "/api/companies?sort=name" });
    const namesAsc = asc.json().items.map((c: { name: string }) => c.name);
    expect(namesAsc.indexOf("alpha inc")).toBeLessThan(namesAsc.indexOf("Beta Ltd"));

    const desc = await app.inject({ method: "GET", url: "/api/companies?sort=-name" });
    const namesDesc = desc.json().items.map((c: { name: string }) => c.name);
    expect(namesDesc.indexOf("Beta Ltd")).toBeLessThan(namesDesc.indexOf("alpha inc"));
  });

  it("list total ignores limit", async () => {
    const all = await app.inject({ method: "GET", url: "/api/companies" });
    const total = all.json().total;
    const limited = await app.inject({ method: "GET", url: "/api/companies?limit=1" });
    expect(limited.json().total).toBe(total);
    expect(limited.json().items).toHaveLength(1);
  });

  it("patches fields and updatedAt", async () => {
    const created = (await post({ name: "PatchCorp" })).json();
    expect(created.updatedAt).toBe(created.createdAt);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/companies/${created.id}`,
      payload: { website: "https://patched.example", aiContext: "notes" },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.website).toBe("https://patched.example");
    expect(updated.aiContext).toBe("notes");
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(created.createdAt).getTime());
  });

  it("patch with empty body returns 400", async () => {
    const created = (await post({ name: "EmptyPatch" })).json();
    const res = await app.inject({ method: "PATCH", url: `/api/companies/${created.id}`, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("malformed JSON body returns 400, not 500", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/companies",
      headers: { "content-type": "application/json" },
      payload: "{bad",
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBeDefined();
    expect(body.error.code).not.toBe("INTERNAL");
  });

  it("patch website to null clears it", async () => {
    const created = (await post({ name: "NullPatch", website: "https://clearme.example" })).json();
    expect(created.website).toBe("https://clearme.example");

    const res = await app.inject({
      method: "PATCH",
      url: `/api/companies/${created.id}`,
      payload: { website: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().website).toBeNull();

    const got = await app.inject({ method: "GET", url: `/api/companies/${created.id}` });
    expect(got.json().website).toBeNull();
  });

  it("returns 404 for unknown ids on get/patch/delete", async () => {
    const get = await app.inject({ method: "GET", url: "/api/companies/99999" });
    expect(get.statusCode).toBe(404);
    expect(get.json().error.code).toBe("NOT_FOUND");

    const patch = await app.inject({ method: "PATCH", url: "/api/companies/99999", payload: { description: "x" } });
    expect(patch.statusCode).toBe(404);

    const del = await app.inject({ method: "DELETE", url: "/api/companies/99999" });
    expect(del.statusCode).toBe(404);
  });

  it("deletes a company without postings (204)", async () => {
    const created = (await post({ name: "Deletable" })).json();
    const res = await app.inject({ method: "DELETE", url: `/api/companies/${created.id}` });
    expect(res.statusCode).toBe(204);
  });

  it("returns 409 deleting a company with postings, and cascade deletes them", async () => {
    const created = (await post({ name: "WithPostings" })).json();
    db.prepare(
      `INSERT INTO postings (company_id, title, state) VALUES (?, ?, 'applied')`,
    ).run(created.id, "Engineer");

    const noCascade = await app.inject({ method: "DELETE", url: `/api/companies/${created.id}` });
    expect(noCascade.statusCode).toBe(409);
    expect(noCascade.json().error.code).toBe("CONFLICT");

    const cascade = await app.inject({ method: "DELETE", url: `/api/companies/${created.id}?cascade=true` });
    expect(cascade.statusCode).toBe(204);

    const postings = db.prepare("SELECT COUNT(*) as count FROM postings WHERE company_id = ?").get(created.id) as { count: number };
    expect(postings.count).toBe(0);
  });
});
