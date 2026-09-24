import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";

function makeWebDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "web-dist-"));
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), "<h1>hi</h1>");
  fs.writeFileSync(path.join(dir, "assets", "x.js"), "console.log('x');");
  return dir;
}

describe("static web serving", () => {
  let webDist: string;
  let db: Database;
  let app: FastifyInstance;

  beforeAll(async () => {
    webDist = makeWebDist();
    db = openDb(":memory:");
    app = buildApp(db, { webDist });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.close();
    fs.rmSync(webDist, { recursive: true, force: true });
  });

  it("serves index.html at /", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("<h1>hi</h1>");
  });

  it("serves nested assets", async () => {
    const res = await app.inject({ method: "GET", url: "/assets/x.js" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("console.log('x');");
  });

  it("keeps /api/health working", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("returns JSON 404 for unknown API paths", async () => {
    const res = await app.inject({ method: "GET", url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("keeps the OpenAPI document served", async () => {
    const res = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(res.statusCode).toBe(200);
    expect(res.json().openapi).toBeTruthy();
  });

  it("falls back to index.html for non-API GET paths", async () => {
    const res = await app.inject({ method: "GET", url: "/some/other/path" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("<h1>hi</h1>");
  });

  it("builds fine when the dist directory is missing", async () => {
    const plainApp = buildApp(openDb(":memory:"), { webDist: path.join(webDist, "does-not-exist") });
    try {
      await plainApp.ready();
      const res = await plainApp.inject({ method: "GET", url: "/api/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    } finally {
      await plainApp.close();
    }
  });
});
