import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { buildMcpServer } from "../src/mcp/server.js";
import { createApiClient } from "../src/mcp/api-client.js";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";

describe("lists", () => {
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

  const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
    app.inject({ method, url, payload });

  const makeList = async (kind: "company" | "posting", name: string) => {
    const res = await call("POST", `/api/${kind}-lists`, { name });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: number; name: string; memberCount: number };
  };

  const makeCompany = async (name: string, listIds?: number[]) => {
    const res = await call("POST", "/api/companies", { name, ...(listIds ? { listIds } : {}) });
    expect(res.statusCode).toBe(201);
    return res.json();
  };

  const makePosting = async (companyName: string, title: string, listIds?: number[]) => {
    const res = await call("POST", "/api/postings", { companyName, title, ...(listIds ? { listIds } : {}) });
    expect(res.statusCode).toBe(201);
    return res.json();
  };

  describe.each(["company", "posting"] as const)("%s list CRUD", (kind) => {
    const base = `/api/${kind}-lists`;

    it("creates, lists (sorted by name), renames and deletes", async () => {
      const b = await makeList(kind, "  beta ");
      expect(b.name).toBe("beta");
      expect(b.memberCount).toBe(0);
      const a = await makeList(kind, "Alpha");

      const list = (await call("GET", base)).json();
      expect(list.total).toBe(2);
      expect(list.items.map((l: { name: string }) => l.name)).toEqual(["Alpha", "beta"]);

      const renamed = await call("PATCH", `${base}/${a.id}`, { name: "Gamma" });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json().name).toBe("Gamma");

      expect((await call("DELETE", `${base}/${a.id}`)).statusCode).toBe(204);
      expect((await call("GET", base)).json().total).toBe(1);
    });

    it("rejects duplicate names case-insensitively, but allows renaming to its own name", async () => {
      const a = await makeList(kind, "Contractors");
      expect((await call("POST", base, { name: "contractors" })).statusCode).toBe(409);
      const b = await makeList(kind, "Other");
      expect((await call("PATCH", `${base}/${b.id}`, { name: "CONTRACTORS" })).statusCode).toBe(409);
      expect((await call("PATCH", `${base}/${a.id}`, { name: "contractors" })).statusCode).toBe(200);
    });

    it("rejects blank names and unknown ids", async () => {
      expect((await call("POST", base, { name: "   " })).statusCode).toBe(400);
      expect((await call("PATCH", `${base}/999`, { name: "x" })).statusCode).toBe(404);
      expect((await call("DELETE", `${base}/999`)).statusCode).toBe(404);
    });
  });

  it("keeps company and posting lists independent (same name allowed in both)", async () => {
    await makeList("company", "Shared name");
    await makeList("posting", "Shared name");
    expect((await call("GET", "/api/company-lists")).json().total).toBe(1);
    expect((await call("GET", "/api/posting-lists")).json().total).toBe(1);
  });

  it("assigns companies via listIds with replace semantics", async () => {
    const l1 = await makeList("company", "Contractors");
    const l2 = await makeList("company", "Never consider");

    const c = await makeCompany("Acme", [l2.id, l1.id, l1.id]);
    expect(c.lists).toEqual([
      { id: l1.id, name: "Contractors" },
      { id: l2.id, name: "Never consider" },
    ]);

    // absent listIds leaves memberships untouched
    const untouched = (await call("PATCH", `/api/companies/${c.id}`, { description: "x" })).json();
    expect(untouched.lists).toHaveLength(2);

    // replace
    const replaced = (await call("PATCH", `/api/companies/${c.id}`, { listIds: [l2.id] })).json();
    expect(replaced.lists).toEqual([{ id: l2.id, name: "Never consider" }]);

    // clear
    const cleared = (await call("PATCH", `/api/companies/${c.id}`, { listIds: [] })).json();
    expect(cleared.lists).toEqual([]);

    const plain = await makeCompany("Plain");
    expect(plain.lists).toEqual([]);
  });

  it("an unknown list id fails with 404 and writes nothing", async () => {
    const l = await makeList("company", "Keep");
    const c = await makeCompany("Acme", [l.id]);

    const bad = await call("PATCH", `/api/companies/${c.id}`, { name: "Renamed", listIds: [l.id, 9999] });
    expect(bad.statusCode).toBe(404);
    const after = (await call("GET", `/api/companies/${c.id}`)).json();
    expect(after.name).toBe("Acme");
    expect(after.lists).toHaveLength(1);

    const badCreate = await call("POST", "/api/companies", { name: "Ghost", listIds: [9999] });
    expect(badCreate.statusCode).toBe(404);
    expect((await call("GET", "/api/companies?q=Ghost")).json().total).toBe(0);

    const badPosting = await call("POST", "/api/postings", { companyName: "NewCo", title: "T", listIds: [9999] });
    expect(badPosting.statusCode).toBe(404);
    expect((await call("GET", "/api/companies?q=NewCo")).json().total).toBe(0);
    expect((await call("GET", "/api/postings")).json().total).toBe(0);

    // a company list id is not valid for postings (separate sets)
    const posting = await call("POST", "/api/postings", { companyName: "Acme", title: "T", listIds: [l.id] });
    expect(posting.statusCode).toBe(404);
  });

  it("assigns postings and filters both endpoints by listId (combined with q)", async () => {
    const pl = await makeList("posting", "Dream jobs");
    const cl = await makeList("company", "Contractors");

    const acme = await makeCompany("Acme", [cl.id]);
    await makeCompany("Globex");
    const p1 = await makePosting("Acme", "Backend Engineer", [pl.id]);
    await makePosting("Acme", "Frontend Engineer");
    await makePosting("Globex", "Backend Developer", [pl.id]);

    expect(p1.lists).toEqual([{ id: pl.id, name: "Dream jobs" }]);

    const inList = (await call("GET", `/api/postings?listId=${pl.id}`)).json();
    expect(inList.total).toBe(2);
    expect(inList.items.every((p: { lists: unknown[] }) => p.lists.length === 1)).toBe(true);

    const combined = (await call("GET", `/api/postings?listId=${pl.id}&q=Acme`)).json();
    expect(combined.total).toBe(1);
    expect(combined.items[0].title).toBe("Backend Engineer");

    expect((await call("GET", "/api/postings?listId=9999")).json().total).toBe(0);

    const companies = (await call("GET", `/api/companies?listId=${cl.id}`)).json();
    expect(companies.items.map((c: { id: number }) => c.id)).toEqual([acme.id]);
    expect(companies.total).toBe(1);

    const detail = (await call("GET", `/api/companies/${acme.id}`)).json();
    expect(detail.lists).toEqual([{ id: cl.id, name: "Contractors" }]);
    expect((await call("GET", `/api/postings/${p1.id}`)).json().lists).toHaveLength(1);

    const cleared = (await call("PATCH", `/api/postings/${p1.id}`, { listIds: [] })).json();
    expect(cleared.lists).toEqual([]);
  });

  it("deleting a list keeps its items; deleting an item keeps the list", async () => {
    const cl = await makeList("company", "Contractors");
    const pl = await makeList("posting", "Dream jobs");
    const c = await makeCompany("Acme", [cl.id]);
    const p = await makePosting("Acme", "Engineer", [pl.id]);

    // deleting a list: items remain, memberships gone
    expect((await call("DELETE", `/api/posting-lists/${pl.id}`)).statusCode).toBe(204);
    const posting = (await call("GET", `/api/postings/${p.id}`)).json();
    expect(posting.lists).toEqual([]);

    // deleting a company (cascade deletes its postings): list stays, member count drops
    expect((await call("DELETE", `/api/companies/${c.id}?cascade=true`)).statusCode).toBe(204);
    const lists = (await call("GET", "/api/company-lists")).json();
    expect(lists.items).toHaveLength(1);
    expect(lists.items[0].memberCount).toBe(0);

    // deleting a posting removes only its membership
    const pl2 = await makeList("posting", "Again");
    const p2 = await makePosting("Solo", "Role", [pl2.id]);
    expect((await call("GET", "/api/posting-lists")).json().items[0].memberCount).toBe(1);
    expect((await call("DELETE", `/api/postings/${p2.id}`)).statusCode).toBe(204);
    expect((await call("GET", "/api/posting-lists")).json().items[0].memberCount).toBe(0);
  });

  describe("MCP", () => {
    let client: Client;
    let baseUrl: string;

    const tool = async (name: string, args: Record<string, unknown> = {}) => {
      const result = (await client.callTool({ name, arguments: args })) as unknown as {
        isError?: boolean;
        content: Array<{ text?: string }>;
      };
      return { isError: result.isError === true, data: JSON.parse(result.content[0].text as string) };
    };

    beforeEach(async () => {
      await app.listen({ port: 0, host: "127.0.0.1" });
      const address = app.server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${address.port}`;
      const server = buildMcpServer(createApiClient(baseUrl), { baseUrl });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      client = new Client({ name: "test-client", version: "1.0.0" });
      await client.connect(clientTransport);
    });

    afterEach(async () => {
      await client.close();
    });

    it("manages lists, passes listIds through and filters by listId", async () => {
      const created = await tool("create_list", { kind: "company", name: "Contractors" });
      expect(created.data.name).toBe("Contractors");

      const company = await tool("create_company", { name: "Acme", listIds: [created.data.id] });
      expect(company.data.lists).toEqual([{ id: created.data.id, name: "Contractors" }]);

      const found = await tool("search_companies", { listId: created.data.id });
      expect(found.data.total).toBe(1);
      expect(found.data.items[0].lists).toEqual([{ id: created.data.id, name: "Contractors" }]);

      const posting = await tool("create_posting", { companyName: "Acme", title: "Engineer" });
      const pl = await tool("create_list", { kind: "posting", name: "Dream jobs" });
      const updated = await tool("update_posting", { id: posting.data.id, listIds: [pl.data.id] });
      expect(updated.data.lists).toHaveLength(1);
      const searched = await tool("search_postings", { listId: pl.data.id });
      expect(searched.data.items[0].lists[0].name).toBe("Dream jobs");

      // create_posting and update_company pass listIds through as well
      const created2 = await tool("create_posting", { companyName: "Acme", title: "Designer", listIds: [pl.data.id] });
      expect(created2.data.lists).toEqual([{ id: pl.data.id, name: "Dream jobs" }]);
      const company2 = await tool("update_company", { id: company.data.id, listIds: [] });
      expect(company2.data.lists).toEqual([]);
      await tool("update_company", { id: company.data.id, listIds: [created.data.id] });

      const renamed = await tool("rename_list", { kind: "company", id: created.data.id, name: "Freelance" });
      expect(renamed.data.name).toBe("Freelance");

      const lists = await tool("get_lists", { kind: "company" });
      expect(lists.data.items[0]).toMatchObject({ name: "Freelance", memberCount: 1 });
    });

    it("delete_list refuses without confirm and deletes with it", async () => {
      const list = await tool("create_list", { kind: "posting", name: "Temp" });
      const refused = await tool("delete_list", { kind: "posting", id: list.data.id });
      expect(refused.isError).toBe(true);
      expect((await tool("get_lists", { kind: "posting" })).data.total).toBe(1);

      const done = await tool("delete_list", { kind: "posting", id: list.data.id, confirm: true });
      expect(done.isError).toBe(false);
      expect((await tool("get_lists", { kind: "posting" })).data.total).toBe(0);
    });
  });
});
