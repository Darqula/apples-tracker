import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";

interface OpenApiOperation {
  summary?: unknown;
  description?: unknown;
  parameters?: Array<{ name: string; in: string; description?: string }>;
}

type OpenApiDocument = {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, OpenApiOperation | undefined>>;
};

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

describe("OpenAPI document", () => {
  const app = buildApp();

  let document!: OpenApiDocument;

  beforeAll(async () => {
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(res.statusCode).toBe(200);
    document = res.json() as OpenApiDocument;
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves an OpenAPI 3 document", () => {
    expect(document.openapi).toMatch(/^3\./);
    expect(document.info.title).toBe("Apples Tracker API");
    expect(document.info.version).toBe("0.1.0");
  });

  it("documents all API paths", () => {
    expect(Object.keys(document.paths).sort()).toEqual(
      expect.arrayContaining([
        "/api/companies",
        "/api/companies/{id}",
        "/api/postings",
        "/api/postings/{id}",
        "/api/context",
        "/api/guide",
        "/api/health",
      ]),
    );
  });

  it("gives every operation a non-empty summary", () => {
    const missing: string[] = [];

    for (const [path, operations] of Object.entries(document.paths)) {
      for (const method of HTTP_METHODS) {
        const operation = operations[method];
        if (operation === undefined) continue;
        if (typeof operation.summary !== "string" || operation.summary.length === 0) {
          missing.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it("explains that the postings list q parameter matches only title and company name", () => {
    const operations = document.paths["/api/postings"]!;
    const list = operations.get!;

    const q = list.parameters?.find((p) => p.name === "q" && p.in === "query");
    expect(q).toBeDefined();
    expect(q?.description ?? "").toContain("title");
    expect(q?.description ?? "").toContain("company name");
  });

  it("serves Swagger UI at /docs", async () => {
    const res = await app.inject({ method: "GET", url: "/docs" });

    if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
      expect(res.headers.location).toBe("/docs/");
      const ui = await app.inject({ method: "GET", url: "/docs/" });
      expect(ui.statusCode).toBe(200);
      expect(String(ui.headers["content-type"])).toContain("text/html");
      return;
    }

    expect(res.statusCode).toBe(200);
    expect(String(res.headers["content-type"])).toContain("text/html");
  });
});
