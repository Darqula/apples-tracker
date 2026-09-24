// Quick API smoke tests (no browser interactions beyond requests).
import { expect, test } from "@playwright/test";

const BASE = "http://127.0.0.1:3070";

test("/openapi.json is OpenAPI 3 and includes /api/postings", async ({ request }) => {
  const res = await request.get(`${BASE}/openapi.json`);
  expect(res.ok()).toBeTruthy();
  const doc = (await res.json()) as { openapi?: string; paths?: Record<string, unknown> };
  expect(doc.openapi).toMatch(/^3\./);
  expect(Object.keys(doc.paths ?? [])).toContain("/api/postings");
});

test("/docs responds", async ({ request }) => {
  const res = await request.get(`${BASE}/docs`);
  expect(res.ok()).toBeTruthy();
  const text = await res.text();
  expect(text.length).toBeGreaterThan(0);
});

test("/api/guide returns markdown containing get_context", async ({ request }) => {
  const res = await request.get(`${BASE}/api/guide`);
  expect(res.ok()).toBeTruthy();
  expect(res.headers()["content-type"]).toContain("text/markdown");
  const text = await res.text();
  expect(text).toContain("get_context");
});
