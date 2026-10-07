import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { buildApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { MAX_CONTEXT_HISTORY } from "../src/routes/context.js";
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

  // PUT against the current version (expectedUpdatedAt is required).
  const putCurrent = async (content: string, extra: object = {}) => {
    const current = (await get()).json();
    return put({ content, expectedUpdatedAt: current.updatedAt, ...extra });
  };

  it("GET returns empty content and an updatedAt initially", async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toBe("");
    expect(typeof body.updatedAt).toBe("string");
    expect(body.updatedAt.length).toBeGreaterThan(0);
  });

  it("PUT stores content and returns the new state", async () => {
    const res = await putCurrent("Target: senior frontend roles");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toBe("Target: senior frontend roles");
    expect(typeof body.updatedAt).toBe("string");

    const got = await get();
    expect(got.json()).toEqual(body);
  });

  it("PUT accepts empty content when forced", async () => {
    const res = await putCurrent("", { force: true });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toBe("");
  });

  it("returns 400 when expectedUpdatedAt is missing", async () => {
    const res = await put({ content: "no guard" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("returns 409 and does not write when expectedUpdatedAt is stale", async () => {
    await sleep(3);
    const before = (await get()).json();
    await sleep(3);
    await put({ content: "second write", expectedUpdatedAt: before.updatedAt });
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
    const res = await put({ expectedUpdatedAt: (await get()).json().updatedAt });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("returns 400 when content exceeds max length", async () => {
    const res = await putCurrent("x".repeat(100001));
    expect(res.statusCode).toBe(400);
  });
});

describe("context history and shrink guard", () => {
  let db: Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = openDb(":memory:");
    app = buildApp(db);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  const get = async () => (await app.inject({ method: "GET", url: "/api/context" })).json();
  const write = async (content: string, extra: object = {}) =>
    app.inject({
      method: "PUT",
      url: "/api/context",
      payload: { content, expectedUpdatedAt: (await get()).updatedAt, ...extra },
    });
  const history = async () => (await app.inject({ method: "GET", url: "/api/context/history" })).json();
  const count = () => (db.prepare("SELECT COUNT(*) AS n FROM context_history").get() as { n: number }).n;

  it("snapshots the previous content on overwrite, but not the initial empty note", async () => {
    expect((await write("v1")).statusCode).toBe(200);
    expect(count()).toBe(0);

    expect((await write("v2")).statusCode).toBe(200);
    expect(count()).toBe(1);

    const { items } = await history();
    expect(items).toHaveLength(1);
    const entry = (await app.inject({ method: "GET", url: `/api/context/history/${items[0].id}` })).json();
    expect(entry.content).toBe("v1");
    expect(typeof entry.updatedAt).toBe("string");
    expect(typeof entry.replacedAt).toBe("string");
  });

  it("does not snapshot a write with identical content", async () => {
    await write("same");
    await write("same");
    expect(count()).toBe(0);
  });

  it("lists versions newest first with length and without content", async () => {
    await write("a");
    await write("bb");
    await write("ccc");

    const { items } = await history();
    expect(items.map((i: { length: number }) => i.length)).toEqual([2, 1]);
    expect(items[0]).not.toHaveProperty("content");
    expect(items[0].id).toBeGreaterThan(items[1].id);
  });

  it("returns 404 for an unknown version", async () => {
    const res = await app.inject({ method: "GET", url: "/api/context/history/999" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("keeps at most 50 versions and drops the oldest", async () => {
    for (let i = 0; i <= 55; i++) {
      expect((await write(`version ${i}`)).statusCode).toBe(200);
    }
    const { items } = await history();
    expect(items).toHaveLength(MAX_CONTEXT_HISTORY);

    const oldest = (
      await app.inject({ method: "GET", url: `/api/context/history/${items[items.length - 1].id}` })
    ).json();
    // 55 snapshots were taken (version 0..54); the first 5 were pruned.
    expect(oldest.content).toBe("version 5");
    const newest = (await app.inject({ method: "GET", url: `/api/context/history/${items[0].id}` })).json();
    expect(newest.content).toBe("version 54");
  });

  it("refuses a drastic shrink with 422 SHRINK_GUARD and writes nothing", async () => {
    const long = "x".repeat(300);
    await write(long);
    const res = await write("y".repeat(50));
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("SHRINK_GUARD");
    expect((await get()).content).toBe(long);
    expect(count()).toBe(0);
  });

  it("allows a drastic shrink with force=true and snapshots the old note", async () => {
    const long = "x".repeat(300);
    await write(long);
    const res = await write("y".repeat(50), { force: true });
    expect(res.statusCode).toBe(200);
    expect(count()).toBe(1);
  });

  it("allows shrinking short notes and moderate reductions", async () => {
    await write("z".repeat(150));
    expect((await write("a")).statusCode).toBe(200);

    await write("x".repeat(300));
    expect((await write("x".repeat(160))).statusCode).toBe(200);
  });

  it("reports a stale expectedUpdatedAt as 409 before the shrink guard", async () => {
    await write("x".repeat(300));
    const res = await app.inject({
      method: "PUT",
      url: "/api/context",
      payload: { content: "tiny", expectedUpdatedAt: "1970-01-01T00:00:00.000Z" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT");
  });

  it("requires force to erase a non-empty note, even a short one", async () => {
    await write("short note");
    const refused = await write("");
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.code).toBe("SHRINK_GUARD");
    expect((await get()).content).toBe("short note");

    expect((await write("", { force: true })).statusCode).toBe(200);
    // Clearing an already empty note is not an erase.
    expect((await write("")).statusCode).toBe(200);
  });

  it("applies the guard exactly at its boundaries", async () => {
    await write("x".repeat(199));
    expect((await write("y".repeat(10))).statusCode).toBe(200); // 199 chars: below the minimum

    await write("x".repeat(200));
    expect((await write("y".repeat(99))).statusCode).toBe(422); // 99 < 50% of 200
    expect((await write("y".repeat(100))).statusCode).toBe(200); // exactly 50% is allowed
  });

  it("rejects a stale expectedUpdatedAt even with force", async () => {
    await write("x".repeat(300));
    const res = await app.inject({
      method: "PUT",
      url: "/api/context",
      payload: { content: "tiny", expectedUpdatedAt: "1970-01-01T00:00:00.000Z", force: true },
    });
    expect(res.statusCode).toBe(409);
  });

  it("does not coerce malformed values into a valid or forced write", async () => {
    await write("keep me");
    const expectedUpdatedAt = (await get()).updatedAt;
    const send = (payload: object) => app.inject({ method: "PUT", url: "/api/context", payload });

    for (const payload of [
      { content: null, expectedUpdatedAt },
      { content: 5, expectedUpdatedAt },
      { content: "x", expectedUpdatedAt: 5 },
      { content: "x", expectedUpdatedAt, force: "true" },
    ]) {
      const res = await send(payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION");
    }
    expect((await get()).content).toBe("keep me");
  });

  it("returns 400 for a non-numeric history id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/context/history/abc" });
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
