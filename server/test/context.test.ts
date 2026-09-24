import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";

describe("context routes", () => {
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

  const get = async () =>
    app.inject({
      method: "GET",
      url: "/api/context",
    });

  const put = async (payload: object) =>
    app.inject({
      method: "PUT",
      url: "/api/context",
      payload,
    });

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("GET returns empty content and an updatedAt initially", async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toBe("");
    expect(typeof body.updatedAt).toBe("string");
    expect(body.updatedAt.length).toBeGreaterThan(0);
  });

  it("PUT stores content and returns the new state", async () => {
    const res = await put({ content: "Target: senior frontend roles" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toBe("Target: senior frontend roles");
    expect(typeof body.updatedAt).toBe("string");

    const got = await get();
    expect(got.json()).toEqual(body);
  });

  it("PUT accepts empty content", async () => {
    const res = await put({ content: "" });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toBe("");
  });

  it("returns 409 and does not write when expectedUpdatedAt is stale", async () => {
    await sleep(3);
    const before = (await get()).json();
    await sleep(3);
    await put({ content: "second write" });
    const current = (await get()).json();
    expect(current.updatedAt).not.toBe(before.updatedAt);

    const res = await put({ content: "stale write", expectedUpdatedAt: before.updatedAt });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT");
    expect(res.json().error.message).toContain("context changed");

    const after = (await get()).json();
    expect(after.content).toBe("second write");
  });

  it("PUT with the current expectedUpdatedAt succeeds", async () => {
    const before = (await get()).json();
    const res = await put({ content: "conflict-free write", expectedUpdatedAt: before.updatedAt });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toBe("conflict-free write");
  });

  it("returns 400 when content is missing", async () => {
    const res = await put({});
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("returns 400 when content exceeds max length", async () => {
    const res = await put({ content: "x".repeat(100001) });
    expect(res.statusCode).toBe(400);
  });
});

describe("guide route", () => {
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

  it("serves the AI usage guide as markdown", async () => {
    const res = await app.inject({ method: "GET", url: "/api/guide" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/markdown");
    const body = res.body as string;
    expect(body).toContain("get_context");
    expect(body).toContain("cascade=true");
  });
});
