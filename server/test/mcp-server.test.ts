import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { buildMcpServer } from "../src/mcp/server.js";
import { createApiClient, ApiCallError, unreachableMessage } from "../src/mcp/api-client.js";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";

const TOOL_NAMES = [
  "search_postings",
  "get_posting",
  "create_posting",
  "update_posting",
  "delete_posting",
  "search_companies",
  "get_company",
  "create_company",
  "update_company",
  "delete_company",
  "get_context",
  "update_context",
];

function decode(result: { content: Array<{ type: string; text?: string }> }) {
  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe("text");
  return JSON.parse(result.content[0].text as string);
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ isError?: boolean; content: Array<{ type: string; text?: string }> }> {
  const result = (await client.callTool({ name, arguments: args })) as unknown as {
    isError?: boolean;
    content: Array<{ type: string; text?: string }>;
  };
  return result;
}

describe("mcp server", () => {
  let db: Database;
  let app: FastifyInstance;
  let baseUrl: string;
  let client: Client;
  /** Builds a fresh MCP server + client pair so closure state (like the remembered
   * context version) starts empty. */
  async function connectFreshServer() {
    const server = buildMcpServer(createApiClient(baseUrl), { baseUrl });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const freshClient = new Client({ name: "test-client", version: "1.0.0" });
    await freshClient.connect(clientTransport);
    return freshClient;
  }

  beforeAll(async () => {
    db = openDb(":memory:");
    app = buildApp(db);
    await app.ready();
    await app.listen({ port: 0, host: "127.0.0.1" });

    const address = app.server.address() as { address: string; port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;

    const server = buildMcpServer(createApiClient(baseUrl), { baseUrl });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await app.close();
    db.close();
  });

  it("lists all tools and mirrors the usage guide in the server instructions", async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("creates a posting with companyName and reads it back", async () => {
    const created = decode(
      await callTool(client, "create_posting", {
        companyName: "MCP Co",
        title: "Backend Engineer",
        state: "applied",
        appliedDate: "2026-09-20",
        urls: ["https://jobs.example/mcp"],
      }),
    );
    expect(created.title).toBe("Backend Engineer");
    expect(created.state).toBe("applied");
    expect(created.company.name).toBe("MCP Co");
    expect(created.appliedDate).toBe("2026-09-20");

    const got = decode(await callTool(client, "get_posting", { id: created.id }));
    expect(got.id).toBe(created.id);
    expect(got.description).toBe("");
    expect(got.urls).toEqual(["https://jobs.example/mcp"]);
  });

  it("rejects a posting created with both companyId and companyName", async () => {
    const result = await callTool(client, "create_posting", {
      companyId: 1,
      companyName: "BothCo",
      title: "X",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("exactly one");
  });

  it("updates a posting without touching unrelated fields", async () => {
    const created = decode(
      await callTool(client, "create_posting", { companyName: "UpdateCo", title: "Old title" }),
    );

    const updated = decode(
      await callTool(client, "update_posting", { id: created.id, title: "New title", state: "offer" }),
    );
    expect(updated.title).toBe("New title");
    expect(updated.state).toBe("offer");
    expect(updated.description).toBe("");

    const failed = await callTool(client, "update_posting", { id: created.id });
    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).toContain("at least one field");
  });

  it("delete tools refuse without confirm: true and do not delete", async () => {
    const posting = decode(
      await callTool(client, "create_posting", { companyName: "ConfirmCo", title: "Kept" }),
    );
    const companyId = posting.companyId;

    for (const [tool, args] of [
      ["delete_posting", { id: posting.id }],
      ["delete_posting", { id: posting.id, confirm: false }],
      ["delete_company", { id: companyId }],
      ["delete_company", { id: companyId, confirm: false }],
    ] as const) {
      const refused = await callTool(client, tool, args);
      expect(refused.isError).toBe(true);
      expect(refused.content[0].text).toContain(
        "Ask the user for explicit confirmation, then call again with confirm: true",
      );
    }

    // Nothing was deleted.
    const keptPosting = await callTool(client, "get_posting", { id: posting.id });
    expect(keptPosting.isError).toBeUndefined();
    const keptCompany = await callTool(client, "get_company", { id: companyId });
    expect(keptCompany.isError).toBeUndefined();

    // With confirm: true both deletes go through (company after the posting).
    expect((await callTool(client, "delete_posting", { id: posting.id, confirm: true })).isError).toBeUndefined();
    const cascadeCompany = await callTool(client, "delete_company", {
      id: companyId,
      confirm: true,
      cascade: true,
    });
    expect(cascadeCompany.isError).toBeUndefined();
    expect((await callTool(client, "get_posting", { id: posting.id })).isError).toBe(true);
  });

  it("deletes a posting, then get fails with NOT_FOUND", async () => {
    const created = decode(
      await callTool(client, "create_posting", { companyName: "DeleteMcp", title: "Gone" }),
    );

    const deleted = await callTool(client, "delete_posting", { id: created.id, confirm: true });
    expect(deleted.isError).toBeUndefined();

    const failed = await callTool(client, "get_posting", { id: created.id });
    expect(failed.isError).toBe(true);
    const error = decode(failed);
    expect(error.status).toBe(404);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("Posting not found");
  });

  it("lists postings with filters and sort, and search only matches title/company", async () => {
    const created = decode(
      await callTool(client, "create_posting", {
        companyName: "SearchMcp Ltd",
        title: "DistinctiveRole",
        description: "needle-in-description",
      }),
    );

    const found = decode(await callTool(client, "search_postings", { q: "DISTINCTIVE" }));
    expect(found.items.map((p: { id: number }) => p.id)).toContain(created.id);

    const byCompany = decode(await callTool(client, "search_postings", { q: "searchmcp" }));
    expect(byCompany.items.map((p: { id: number }) => p.id)).toEqual(
      [created.id].filter((id: number) => id > 0),
    );

    const byDescription = decode(await callTool(client, "search_postings", { q: "needle-in-description" }));
    expect(byDescription.total).toBe(0);

    const byId = decode(await callTool(client, "search_postings", { companyId: created.companyId, sort: "stage" }));
    expect(byId.items.map((p: { id: number }) => p.id)).toContain(created.id);

    const badSort = await callTool(client, "search_postings", { sort: "bogus" });
    expect(badSort.isError).toBe(true);
  });

  it("companies: create, duplicate name conflict, get with postings, delete cascade", async () => {
    const created = decode(await callTool(client, "create_company", { name: "DupMcp", location: "Berlin" }));

    const conflict = await callTool(client, "create_company", { name: "dupmcp" });
    expect(conflict.isError).toBe(true);
    expect(decode(conflict).code).toBe("CONFLICT");

    const withPosting = decode(
      await callTool(client, "create_posting", { companyId: created.id, title: "Child posting" }),
    );

    const got = decode(await callTool(client, "get_company", { id: created.id }));
    expect(got.postingCount).toBe(1);
    expect(got.postings).toEqual([
      { id: withPosting.id, title: "Child posting", state: "saved", appliedDate: null },
    ]);

    const refused = await callTool(client, "delete_company", { id: created.id, confirm: true });
    expect(refused.isError).toBe(true);
    expect(decode(refused).code).toBe("CONFLICT");

    const cascaded = await callTool(client, "delete_company", {
      id: created.id,
      confirm: true,
      cascade: true,
    });
    expect(cascaded.isError).toBeUndefined();

    const gone = await callTool(client, "get_posting", { id: withPosting.id });
    expect(gone.isError).toBe(true);
  });

  it("updates a company and validates website URLs", async () => {
    const created = decode(await callTool(client, "create_company", { name: "WebsiteCo" }));

    const updated = decode(
      await callTool(client, "update_company", {
        id: created.id,
        website: "https://websiteco.example",
        description: "d",
      }),
    );
    expect(updated.website).toBe("https://websiteco.example");

    const badUrl = await callTool(client, "create_company", { name: "BadUrlCo", website: "not-a-url" });
    expect(badUrl.isError).toBe(true);
  });

  it("search_companies finds by name and returns totals", async () => {
    const list = decode(await callTool(client, "search_companies", { q: "WebsiteCo" }));
    expect(list.total).toBeGreaterThanOrEqual(1);
    expect(list.items[0]).toHaveProperty("name");
    expect(list.items[0]).toHaveProperty("postingCount");
  });

  it("exposes the usage guide as a resource", async () => {
    const listed = await client.listResources();
    const guide = listed.resources.find((r) => r.uri === "apples://guide");
    expect(guide).toBeDefined();
    expect(guide?.name).toBe("Apples Tracker usage guide");
    expect(guide?.mimeType).toBe("text/markdown");

    const read = await client.readResource({ uri: "apples://guide" });
    expect(read.contents[0].mimeType).toBe("text/markdown");
    expect(read.contents[0].text).toContain("cascade=true");
  });

  it("search results are compact but get_* returns the full record", async () => {
    decode(
      await callTool(client, "create_company", {
        name: "CompactCo",
        aiContext: "secret-company-notes",
      }),
    );
    const posting = decode(
      await callTool(client, "create_posting", {
        companyName: "CompactCo",
        title: "CompactRole",
        aiContext: "secret-posting-notes",
      }),
    );

    const postingList = decode(await callTool(client, "search_postings", { q: "CompactRole" }));
    expect(postingList.total).toBe(1);
    expect(postingList.items[0].company).toBe("CompactCo");
    expect(postingList.items[0].title).toBe("CompactRole");
    expect(postingList.items[0].description).toBe("");
    expect(postingList.items[0].urls).toEqual([]);
    expect(postingList.items[0]).not.toHaveProperty("aiContext");
    expect(postingList.items[0]).not.toHaveProperty("createdAt");
    expect(postingList.items[0]).not.toHaveProperty("updatedAt");

    const fullPosting = decode(await callTool(client, "get_posting", { id: posting.id }));
    expect(fullPosting.aiContext).toBe("secret-posting-notes");
    expect(fullPosting.company.name).toBe("CompactCo");

    const companyList = decode(await callTool(client, "search_companies", { q: "CompactCo" }));
    expect(companyList.items).toHaveLength(1);
    expect(companyList.items[0]).not.toHaveProperty("aiContext");
    expect(companyList.items[0]).not.toHaveProperty("createdAt");
    expect(companyList.items[0]).not.toHaveProperty("updatedAt");

    const fullCompany = decode(await callTool(client, "get_company", { id: posting.companyId }));
    expect(fullCompany.aiContext).toBe("secret-company-notes");
  });

  it("update_posting moves a posting by companyName, creating the company if needed", async () => {
    const inLower = decode(
      await callTool(client, "create_posting", { companyName: "SentenceCaseCo", title: "ToMove" }),
    );

    const moved = decode(
      await callTool(client, "update_posting", { id: inLower.id, companyName: "sentencecaseco" }),
    );
    expect(moved.company.id).toBe(inLower.companyId);
    expect(moved.company.name).toBe("SentenceCaseCo");

    const createdForName = decode(
      await callTool(client, "update_posting", { id: inLower.id, companyName: "BrandNewCo" }),
    );
    expect(createdForName.company.name).toBe("BrandNewCo");

    const created = decode(await callTool(client, "search_companies", { q: "BrandNewCo" }));
    expect(created.total).toBe(1);

    const both = await callTool(client, "update_posting", {
      id: inLower.id,
      companyId: created.items[0].id,
      companyName: "AnotherCo",
    });
    expect(both.isError).toBe(true);
    expect(both.content[0].text).toContain("provide only one of companyId or companyName");
  });

  it("update_context refuses before any get_context and leaves the note untouched", async () => {
    // A fresh server instance: its closure never called get_context yet.
    const fresh = await connectFreshServer();
    const noteBefore = (await app.inject({ method: "GET", url: "/api/context" })).json<never>();

    const refused = await callTool(fresh, "update_context", { content: "premature" });
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain("Call get_context first");

    const noteAfter = (await app.inject({ method: "GET", url: "/api/context" })).json<never>();
    expect(noteAfter.content).toBe(noteBefore.content);
  });

  it("update_context remembers the version it last read and produced", async () => {
    decode(await callTool(client, "get_context"));

    const updated = decode(
      await callTool(client, "update_context", { content: "Target: backend roles" }),
    );
    expect(updated.content).toBe("Target: backend roles");

    // No re-read in between: the newly written version is remembered.
    const again = decode(
      await callTool(client, "update_context", { content: "Target: backend roles in Berlin" }),
    );
    expect(again.content).toBe("Target: backend roles in Berlin");
  });

  it("update_context detects stale writes and recovers after re-reading", async () => {
    const read = decode(await callTool(client, "get_context"));

    // Someone else (REST, web UI) rewrote the note behind the MCP client's back.
    // The DB stores timestamps with millisecond precision; the previous test that
    // rewrote the context may have run in the same millisecond as this REST write.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await app.inject({
      method: "PUT",
      url: "/api/context",
      payload: { content: "rest-installed content" },
    });

    const stale = await callTool(client, "update_context", { content: "stale overwrite" });
    expect(stale.isError).toBe(true);
    const staleError = decode(stale);
    expect(staleError.code).toBe("CONFLICT");
    expect(staleError.message).toContain("changed since you last read it");

    // The conflict forgetting means even a retry is refused until a re-read.
    const retry = await callTool(client, "update_context", { content: "still stale" });
    expect(retry.isError).toBe(true);
    expect(retry.content[0].text).toContain("Call get_context first");

    // The REST-written content survived; after re-reading the write succeeds.
    expect(decode(await callTool(client, "get_context")).content).toBe("rest-installed content");
    const recovered = decode(
      await callTool(client, "update_context", { content: `${read.content} (recovered)` }),
    );
    expect(recovered.content).toBe(`${read.content} (recovered)`);
  });

  it("update_context no longer asks the model for expectedUpdatedAt", async () => {
    const tools = await client.listTools();
    const updateContext = tools.tools.find((t) => t.name === "update_context");
    expect(updateContext).toBeDefined();
    const properties = (updateContext?.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(properties)).toEqual(["content"]);
    expect(properties).not.toHaveProperty("expectedUpdatedAt");
  });

  it("surfaces unreachable-API errors with the startup hint", async () => {
    const server = buildMcpServer(createApiClient("http://127.0.0.1:1"), { baseUrl: "http://127.0.0.1:1" });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const remote = new Client({ name: "unreachable-client", version: "1.0.0" });
    await remote.connect(clientTransport);

    try {
      const result = await callTool(remote, "search_postings", {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Cannot reach the Apples Tracker API");
    } finally {
      await remote.close();
    }
  });
});

describe("mcp api client", () => {
  let db: Database;
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    db = openDb(":memory:");
    app = buildApp(db);
    await app.ready();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address() as { address: string; port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  it("returns undefined for 204 responses", async () => {
    const created = (await createApiClient(baseUrl).request("POST", "/api/companies", { body: { name: "A" } })) as {
      id: number;
    };
    const result = await createApiClient(baseUrl).request<undefined>("DELETE", `/api/companies/${created.id}`);
    expect(result).toBeUndefined();
  });

  it("maps non-2xx bodies into ApiCallError", async () => {
    try {
      await createApiClient(baseUrl).request("GET", "/api/companies/12345");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiCallError);
      const error = err as ApiCallError;
      expect(error.status).toBe(404);
      expect(error.code).toBe("NOT_FOUND");
      expect(error.message).toBe("Company not found");
    }
  });

  it("describes connection failures with a startup hint", async () => {
    const closed = createApiClient("http://127.0.0.1:1");

    try {
      await closed.request("GET", "/api/context");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiCallError);
      const error = err as ApiCallError;
      expect(error.code).toBe("UNREACHABLE");
      expect(error.message).toBe(unreachableMessage("http://127.0.0.1:1"));
      expect(error.message).toContain("Start it with `npm run dev` (or `npm start`).");
    }
  });
});
