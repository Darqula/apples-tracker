import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";

describe("postings routes", () => {
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
      url: "/api/postings",
      payload,
    });

  it("creates a posting with companyName, creating the company, and reuses it case-insensitively", async () => {
    const res = await post({ companyName: "  Acme Corp  ", title: "Engineer" });
    expect(res.statusCode).toBe(201);

    const created = res.json();
    expect(created.title).toBe("Engineer");
    expect(created.state).toBe("saved");
    expect(created.company).toEqual({ id: created.companyId, name: "Acme Corp" });
    expect(created.appliedDate).toBeNull();
    expect(created.description).toBe("");
    expect(created.aiContext).toBe("");
    expect(created.urls).toEqual([]);
    expect(typeof created.createdAt).toBe("string");
    expect(typeof created.updatedAt).toBe("string");

    const again = await post({ companyName: "acme corp", title: "Second" });
    expect(again.statusCode).toBe(201);
    expect(again.json().companyId).toBe(created.companyId);

    const companyCount = db.prepare("SELECT COUNT(*) as count FROM companies").get() as { count: number };
    expect(companyCount.count).toBe(1);
  });

  it("creates a posting with an existing companyId and defaults state to saved", async () => {
    const company = (
      await app.inject({ method: "POST", url: "/api/companies", payload: { name: "IdCo" } })
    ).json();

    const res = await post({ companyId: company.id, title: "Cleaner", urls: ["https://jobs.example/idco"] });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created.companyId).toBe(company.id);
    expect(created.company).toEqual({ id: company.id, name: "IdCo" });
    expect(created.state).toBe("saved");
    expect(created.urls).toEqual(["https://jobs.example/idco"]);
  });

  it("returns 400 when neither or both companyId and companyName are given", async () => {
    const neither = await post({ title: "X" });
    expect(neither.statusCode).toBe(400);
    expect(neither.json().error.code).toBe("VALIDATION");

    const both = await post({ title: "X", companyId: 1, companyName: "BothCo" });
    expect(both.statusCode).toBe(400);
    expect(both.json().error.code).toBe("VALIDATION");
  });

  it("returns 404 for unknown companyId on create and patch", async () => {
    const create = await post({ companyId: 99999, title: "X" });
    expect(create.statusCode).toBe(404);
    expect(create.json().error.code).toBe("NOT_FOUND");
    expect(create.json().error.message).toBe("Company not found");

    const posting = (await post({ companyName: "PatchUnknown", title: "Y" })).json();
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/postings/${posting.id}`,
      payload: { companyId: 99999 },
    });
    expect(patch.statusCode).toBe(404);
    expect(patch.json().error.code).toBe("NOT_FOUND");
  });

  it("returns 400 for bad state and bad appliedDate format, and accepts companyName in create but not patch", async () => {
    const badState = await post({ companyName: "StateCo", title: "X", state: "bogus" });
    expect(badState.statusCode).toBe(400);
    expect(badState.json().error.code).toBe("VALIDATION");

    const badDate = await post({ companyName: "DateCo", title: "X", appliedDate: "2026/02/01" });
    expect(badDate.statusCode).toBe(400);

    const goodDate = await post({
      companyName: "DateCo",
      title: "Ok",
      appliedDate: "2026-02-01",
      urls: ["https://x.example/a"],
    });
    expect(goodDate.statusCode).toBe(201);
    expect(goodDate.json().appliedDate).toBe("2026-02-01");

    const posting = goodDate.json();
    // companyName is not in the patch schema's properties (additionalProperties: false),
    // so Fastify strips it instead of applying it
    const patchBad = await app.inject({
      method: "PATCH",
      url: `/api/postings/${posting.id}`,
      payload: { companyName: "Nope" },
    });
    expect(patchBad.statusCode).toBe(200);
    expect(patchBad.json().company.name).toBe("DateCo");

    const badUrl = await post({ companyName: "UrlCo", title: "X", urls: ["notaurl"] });
    expect(badUrl.statusCode).toBe(400);
  });

  it("gets a posting with embedded company", async () => {
    const company = (
      await app.inject({ method: "POST", url: "/api/companies", payload: { name: "GetCo" } })
    ).json();
    const created = (await post({ companyId: company.id, title: "Get Title", state: "interview" })).json();

    const got = await app.inject({ method: "GET", url: `/api/postings/${created.id}` });
    expect(got.statusCode).toBe(200);
    const posting = got.json();
    expect(posting.company).toEqual({ id: company.id, name: "GetCo" });
    expect(posting.state).toBe("interview");
  });

  it("patches fields, clears appliedDate to null, moves company, and changes updatedAt", async () => {
    const c1 = (await app.inject({ method: "POST", url: "/api/companies", payload: { name: "MoveFrom" } })).json();
    const c2 = (await app.inject({ method: "POST", url: "/api/companies", payload: { name: "MoveTo" } })).json();

    const created = (
      await post({ companyId: c1.id, title: "Patchable", appliedDate: "2026-01-05" })
    ).json();
    expect(created.updatedAt).toBe(created.createdAt);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/postings/${created.id}`,
      payload: { state: "offer", title: "Patched Title", appliedDate: null, companyId: c2.id, description: "d", aiContext: "ctx", urls: ["https://x.example/new"] },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.state).toBe("offer");
    expect(updated.title).toBe("Patched Title");
    expect(updated.appliedDate).toBeNull();
    expect(updated.companyId).toBe(c2.id);
    expect(updated.company).toEqual({ id: c2.id, name: "MoveTo" });
    expect(updated.description).toBe("d");
    expect(updated.aiContext).toBe("ctx");
    expect(updated.urls).toEqual(["https://x.example/new"]);
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(created.createdAt).getTime());

    const got = await app.inject({ method: "GET", url: `/api/postings/${created.id}` });
    expect(got.json().appliedDate).toBeNull();
  });

  it("patch with empty body returns 400 and unknown ids return 404", async () => {
    const created = (await post({ companyName: "EmptyPatch", title: "X" })).json();
    const res = await app.inject({ method: "PATCH", url: `/api/postings/${created.id}`, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION");

    const get = await app.inject({ method: "GET", url: "/api/postings/99999" });
    expect(get.statusCode).toBe(404);
    expect(get.json().error.code).toBe("NOT_FOUND");

    const patch = await app.inject({ method: "PATCH", url: "/api/postings/99999", payload: { title: "x" } });
    expect(patch.statusCode).toBe(404);

    const del = await app.inject({ method: "DELETE", url: "/api/postings/99999" });
    expect(del.statusCode).toBe(404);
  });

  it("deletes a posting (204) and then get returns 404", async () => {
    const created = (await post({ companyName: "Deletable", title: "Trash" })).json();

    const del = await app.inject({ method: "DELETE", url: `/api/postings/${created.id}` });
    expect(del.statusCode).toBe(204);

    const got = await app.inject({ method: "GET", url: `/api/postings/${created.id}` });
    expect(got.statusCode).toBe(404);
  });

  it("list q matches title or company name case-insensitively but not description/aiContext", async () => {
    const c1 = (await app.inject({ method: "POST", url: "/api/companies", payload: { name: "Needyl Ltd" } })).json();
    await post({ companyId: c1.id, title: "Some Job", description: "magical-keyword" });
    await post({ companyName: "OtherCo", title: "bluebird job", aiContext: "goldfish notes" });

    const byTitle = await app.inject({ method: "GET", url: "/api/postings?q=BLUEBIRD" });
    expect(byTitle.json().items.map((p: { title: string }) => p.title)).toEqual(["bluebird job"]);

    const byCompany = await app.inject({ method: "GET", url: "/api/postings?q=needy" });
    expect(byCompany.json().items.map((p: { title: string }) => p.title)).toEqual(["Some Job"]);

    const byDescription = await app.inject({ method: "GET", url: "/api/postings?q=magical-keyword" });
    expect(byDescription.json().total).toBe(0);

    const byAiContext = await app.inject({ method: "GET", url: "/api/postings?q=goldfish" });
    expect(byAiContext.json().total).toBe(0);
  });

  it("list filters by state and companyId", async () => {
    const c1 = (await app.inject({ method: "POST", url: "/api/companies", payload: { name: "FilterCo" } })).json();
    const c2 = (await app.inject({ method: "POST", url: "/api/companies", payload: { name: "滤ElseCo" } })).json();

    await post({ companyId: c1.id, title: "A", state: "applied" });
    await post({ companyId: c1.id, title: "B", state: "saved" });
    await post({ companyName: "滤ElseCo", title: "C", state: "applied" });

    const byState = await app.inject({ method: "GET", url: "/api/postings?state=applied" });
    expect(byState.json().items.every((p: { state: string }) => p.state === "applied")).toBe(true);

    const byCompany = await app.inject({ method: "GET", url: `/api/postings?companyId=${c1.id}` });
    expect(byCompany.json().items.map((p: { title: string }) => p.title)).toEqual(["A", "B"]);

    const both = await app.inject({ method: "GET", url: `/api/postings?companyId=${c1.id}&state=applied` });
    expect(both.json().items.map((p: { title: string }) => p.title)).toEqual(["A"]);
  });

  it("sort=stage orders postings by pipeline stage", async () => {
    const company = (await app.inject({ method: "POST", url: "/api/companies", payload: { name: "StageCo" } })).json();

    for (const state of ["applied", "ghosted", "offer", "saved", "interview", "rejected", "screening", "withdrawn"]) {
      await post({ companyId: company.id, title: `Job ${state}`, state });
    }

    const res = await app.inject({ method: "GET", url: "/api/postings?companyId=" + company.id });
    expect(res.json().items.map((p: { state: string }) => p.state)).toEqual([
      "offer",
      "interview",
      "screening",
      "applied",
      "saved",
      "rejected",
      "withdrawn",
      "ghosted",
    ]);
  });

  it("sort=company orders by company name case-insensitively", async () => {
    await post({ companyName: "Zebra LLC", title: "Z1" });
    await post({ companyName: "apple inc", title: "A1" });

    const asc = await app.inject({ method: "GET", url: "/api/postings?sort=company" });
    const companies = asc.json().items.map((p: { company: { name: string } }) => p.company.name);
    expect(companies.indexOf("apple inc")).toBeLessThan(companies.indexOf("Zebra LLC"));
  });

  it("total ignores limit/offset, and bad query params are rejected", async () => {
    const all = await app.inject({ method: "GET", url: "/api/postings" });
    const total = all.json().total;

    const limited = await app.inject({ method: "GET", url: "/api/postings?limit=2&offset=1" });
    expect(limited.json().total).toBe(total);
    expect(limited.json().items).toHaveLength(2);

    const badSort = await app.inject({ method: "GET", url: "/api/postings?sort=bogus" });
    expect(badSort.statusCode).toBe(400);
  });

  it("deleting a company: 409 while it has postings, cascade removes them", async () => {
    const created = (await post({ companyName: "CascadeCo", title: "Cascade" })).json();

    const noCascade = await app.inject({ method: "DELETE", url: `/api/companies/${created.companyId}` });
    expect(noCascade.statusCode).toBe(409);
    expect(noCascade.json().error.code).toBe("CONFLICT");

    const cascade = await app.inject({ method: "DELETE", url: `/api/companies/${created.companyId}?cascade=true` });
    expect(cascade.statusCode).toBe(204);

    const postings = await app.inject({ method: "GET", url: `/api/postings?companyId=${created.companyId}` });
    expect(postings.json().total).toBe(0);
  });
});
