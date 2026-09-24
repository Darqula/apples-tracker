import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readAiGuide } from "../routes/context.js";
import { STATES } from "../schemas.js";
import type { ApiClient } from "./api-client.js";
import { ApiCallError } from "./api-client.js";

// ---------------------------------------------------------------------------
// Zod input shapes — mirror the REST contract in src/schemas.ts
// ---------------------------------------------------------------------------

const fullUrl = z.string().regex(/^https?:\/\//, "must be a full http(s) URL");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date (YYYY-MM-DD)");
const positiveInt = z.number().int().min(1);

const idArgShape = { id: positiveInt };

// Shapes of API responses the MCP layer post-processes (the ids/types mirror the REST
// schema in src/schemas.ts).
interface ApiPosting {
  id: number;
  companyId: number;
  company: { id: number; name: string };
  title: string;
  state: string;
  appliedDate: string | null;
  description: string;
  urls: string[];
}
interface ApiContext {
  content: string;
  updatedAt: string;
}
interface ApiCompany {
  id: number;
  name: string;
  website: string | null;
  location: string | null;
  description: string;
  urls: string[];
  postingCount: number;
}

const postingSearchShape = {
  q: z.string().optional(),
  state: z.enum(STATES).optional(),
  companyId: positiveInt.optional(),
  sort: z.enum(["stage", "company", "applied", "-applied", "title", "updated"]).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
  offset: z.number().int().min(0).optional(),
};

const postingCreateShape = z
  .object({
    companyId: positiveInt.optional(),
    companyName: z.string().min(1).optional(),
    title: z.string().min(1),
    state: z.enum(STATES).optional(),
    appliedDate: isoDate.nullable().optional(),
    description: z.string().optional(),
    aiContext: z.string().optional(),
    urls: z.array(fullUrl).optional(),
  })
  .refine((body) => (body.companyId !== undefined) !== (body.companyName !== undefined), {
    message: "provide exactly one of companyId or companyName",
  });

const postingPatchShape = z
  .object({
    id: positiveInt,
    companyId: positiveInt.optional(),
    companyName: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    state: z.enum(STATES).optional(),
    appliedDate: isoDate.nullable().optional(),
    description: z.string().optional(),
    aiContext: z.string().optional(),
    urls: z.array(fullUrl).optional(),
  })
  .refine((body) => Object.entries(body).some(([key, value]) => key !== "id" && value !== undefined), {
    message: "body must contain at least one field beside id",
  })
  .refine((body) => !(body.companyId !== undefined && body.companyName !== undefined), {
    message: "provide only one of companyId or companyName",
  });

const companySearchShape = {
  q: z.string().optional(),
  sort: z.enum(["name", "-name", "created", "-created"]).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  offset: z.number().int().min(0).optional(),
};

const companyFieldsShape = {
  website: fullUrl.nullable().optional(),
  location: z.string().nullable().optional(),
  description: z.string().optional(),
  aiContext: z.string().optional(),
  urls: z.array(fullUrl).optional(),
};

const companyCreateShape = z.object({ name: z.string().min(1), ...companyFieldsShape });

const companyPatchShape = z
  .object({ id: positiveInt, name: z.string().min(1).optional(), ...companyFieldsShape })
  .refine((body) => Object.entries(body).some(([key, value]) => key !== "id" && value !== undefined), {
    message: "body must contain at least one field beside id",
  });

const contextUpdateShape = z.object({
  content: z.string().max(100000),
});

// ---------------------------------------------------------------------------
// Tool result helpers
// ---------------------------------------------------------------------------

interface ToolError {
  status?: number;
  code: string;
  message: string;
}

/** Raised by tool handlers instead of calling the API; never reached the API. */
class ToolRejection extends Error {
  constructor(
    message: string,
    readonly code: string = "CONFIRMATION_REQUIRED",
  ) {
    super(message);
  }
}

function textResult(data: unknown) {
  return Promise.resolve({
    content: [{ type: "text" as const, text: JSON.stringify(data ?? null, null, 2) }],
  });
}

function errorResult(error: unknown, baseUrl: string) {
  let toolError: ToolError;

  if (error instanceof Error) {
    const status = (error as unknown as { status?: number }).status;
    const code = (error as unknown as { code?: string }).code;
    toolError = {
      status,
      code: typeof code === "string" ? code : "UNEXPECTED",
      message: error.message,
    };
  } else {
    toolError = { code: "UNEXPECTED", message: String(error) };
  }

  return Promise.resolve({
    isError: true as const,
    content: [
      { type: "text" as const, text: JSON.stringify({ baseUrl, ...toolError }, null, 2) },
    ],
  });
}

// ---------------------------------------------------------------------------
// Server assembly
// ---------------------------------------------------------------------------

export interface McpServerOptions {
  /** Base URL of the REST API, surfaced to models in error messages. */
  baseUrl: string;
}

export function buildMcpServer(api: ApiClient, options: McpServerOptions) {
  const guide = readAiGuide();

  const server = new McpServer(
    { name: "apples-tracker", version: "0.1.0" },
    { instructions: guide },
  );

  // The usage guide from the server instructions, exposed as a readable resource.
  server.registerResource(
    "Apples Tracker usage guide",
    "apples://guide",
    {
      mimeType: "text/markdown",
      description: "How an AI assistant should use this tracker",
    },
    (uri: URL) => ({ contents: [{ uri: uri.toString(), mimeType: "text/markdown", text: guide }] }),
  );

  // The SDK derives the input type from the Zod schema at runtime; the handler's
  // arg type is annotated at each call site, so the `any` casts stay contained.
  const tool = (
    name: string,
    config: { description: string },
    schema: unknown,
    handler: (args: any) => Promise<unknown>,
    annotations?: Record<string, boolean>,
  ) =>
    server.registerTool(
      name,
      {
        description: config.description,
        inputSchema: schema as any,
        annotations: annotations as never,
      },
      async (rawArgs: unknown) => {
        try {
          return await textResult(await handler(rawArgs));
        } catch (err) {
          return await errorResult(err, options.baseUrl);
        }
      },
    );

  // --- Postings -------------------------------------------------------------

  tool(
    "search_postings",
    {
      description:
        "List and search job postings. Optional filters: q (matches only job title and company name, " +
        "case-insensitive substring — never description or AI context), state, companyId, sort " +
        "('stage' = most advanced first; also 'company', 'applied', '-applied', 'title', 'updated'), " +
        "limit (1–2000, default 500) and offset. Returns { items, total }; use total for paging. " +
        "Results are compact to save tokens: aiContext is omitted — use get_posting for the full record.",
    },
    postingSearchShape,
    (args) =>
      api
        .request<{ total: number; items: ApiPosting[] }>("GET", "/api/postings", {
          query: {
            q: args.q,
            state: args.state,
            companyId: args.companyId,
            sort: args.sort,
            limit: args.limit,
            offset: args.offset,
          },
        })
        .then((result: { total: number; items: ApiPosting[] }) => ({
          total: result.total,
          items: result.items.map((item) => ({
            id: item.id,
            companyId: item.companyId,
            company: item.company.name,
            title: item.title,
            state: item.state,
            appliedDate: item.appliedDate,
            description: item.description,
            urls: item.urls,
          })),
        })),
    { readOnlyHint: true },
  );

  tool(
    "get_posting",
    {
      description:
        "Get one job posting by id, including its company summary. Fails with NOT_FOUND for unknown ids.",
    },
    idArgShape,
    (args) => api.request("GET", `/api/postings/${args.id}`),
    { readOnlyHint: true },
  );

  tool(
    "create_posting",
    {
      description:
        "Create a job posting. Provide exactly one of companyName (created on the fly if it does not exist; " +
        "search first to avoid duplicates) or companyId of an existing company. title is required; state " +
        "defaults to 'saved'. appliedDate is an ISO YYYY-MM-DD date, urls must be full http(s) links. " +
        "Do not invent facts — leave unknown fields out.",
    },
    postingCreateShape,
    (args) => api.request("POST", "/api/postings", { body: args }),
  );

  tool(
    "update_posting",
    {
      description:
        "Partially update a job posting by id: title, state, appliedDate (null clears it), description, " +
        "aiContext, urls, or companyId to move it to another existing company. companyName moves the posting " +
        "to that company, creating it if missing; give only one of companyId or companyName. Unknown ids fail " +
        "with NOT_FOUND. Read the posting first and preserve existing aiContext notes.",
    },
    postingPatchShape,
    async (args: {
      id: number;
      companyId?: number;
      companyName?: string;
      title?: string;
      state?: string;
      appliedDate?: string | null;
      description?: string;
      aiContext?: string;
      urls?: string[];
    }) => {
      const { id, companyId, companyName, ...body } = args;
      let resolvedCompanyId = companyId;
      if (companyName !== undefined) {
        const trimmed = companyName.trim();
        const search = await api.request<{ total: number; items: ApiCompany[] }>("GET", "/api/companies", {
          query: { q: trimmed, limit: 50 },
        });
        const found = search.items.find(
          (item) => item.name.toLowerCase() === trimmed.toLowerCase(),
        );
        resolvedCompanyId = found
          ? found.id
          : ((await api.request("POST", "/api/companies", { body: { name: trimmed } })) as { id: number }).id;
      }

      return api.request("PATCH", `/api/postings/${id}`, {
        body: resolvedCompanyId !== undefined ? { ...body, companyId: resolvedCompanyId } : body,
      });
    },
  );

  tool(
    "delete_posting",
    {
      description:
        "Delete a job posting by id. Prefer updating over deleting; ask the user for explicit confirmation first, " +
        "then pass confirm: true. Fails with NOT_FOUND for unknown ids.",
    },
    z.object({ id: positiveInt, confirm: z.boolean().optional() }).shape,
    (args: { id: number; confirm?: boolean }) => {
      if (args.confirm !== true) {
        throw new ToolRejection("Ask the user for explicit confirmation, then call again with confirm: true");
      }
      return api.request("DELETE", `/api/postings/${args.id}`);
    },
    { destructiveHint: true },
  );

  // --- Companies ------------------------------------------------------------

  tool(
    "search_companies",
    {
      description:
        "List and search companies with their posting counts. Optional filters: q (matches only the company " +
        "name, case-insensitive substring), sort ('name', '-name', 'created', '-created'), limit (1–1000, " +
        "default 200) and offset. Returns { items, total }. Results are compact to save tokens: aiContext and " +
        "timestamps are omitted — use get_company for the full record. Always search before creating to avoid " +
        "duplicates.",
    },
    companySearchShape,
    (args) =>
      api
        .request<{ total: number; items: ApiCompany[] }>("GET", "/api/companies", {
          query: { q: args.q, sort: args.sort, limit: args.limit, offset: args.offset },
        })
        .then((result: { total: number; items: ApiCompany[] }) => ({
          total: result.total,
          items: result.items.map((item) => ({
            id: item.id,
            name: item.name,
            website: item.website,
            location: item.location,
            description: item.description,
            urls: item.urls,
            postingCount: item.postingCount,
          })),
        })),
    { readOnlyHint: true },
  );

  tool(
    "get_company",
    {
      description:
        "Get one company by id, including a short summary of its postings. Fails with NOT_FOUND for unknown ids.",
    },
    idArgShape,
    (args) => api.request("GET", `/api/companies/${args.id}`),
    { readOnlyHint: true },
  );

  tool(
    "create_company",
    {
      description:
        "Create a company. The name is unique (case-insensitive; duplicates fail with CONFLICT) — search first " +
        "before creating. website must be a full http(s) link; use null to clear it.",
    },
    companyCreateShape,
    (args) => api.request("POST", "/api/companies", { body: args }),
  );

  tool(
    "update_company",
    {
      description:
        "Partially update a company by id: name, website, location, description, aiContext or urls. " +
        "Only the provided fields change; names stay unique case-insensitively. Read the company first " +
        "and preserve existing aiContext notes.",
    },
    companyPatchShape,
    ({ id, ...body }) => api.request("PATCH", `/api/companies/${id}`, { body }),
  );

  tool(
    "delete_company",
    {
      description:
        "Delete a company by id. Prefer updating over deleting; ask the user for explicit confirmation first, " +
        "then pass confirm: true. When the company still has postings the request fails with CONFLICT unless " +
        "cascade=true, which also deletes those postings.",
    },
    z.object({ id: positiveInt, confirm: z.boolean().optional(), cascade: z.boolean().optional() }).shape,
    (args: { id: number; confirm?: boolean; cascade?: boolean }) => {
      if (args.confirm !== true) {
        throw new ToolRejection("Ask the user for explicit confirmation, then call again with confirm: true");
      }
      return api.request("DELETE", `/api/companies/${args.id}`, {
        query: { cascade: args.cascade ? "true" : "false" },
      });
    },
    { destructiveHint: true },
  );

  // --- Context ----------------------------------------------------------------

  // Optimistic locking without a protocol parameter: get_context remembers the
  // version the model last read, and update_context sends it automatically.
  let knownContextUpdatedAt: string | undefined;

  tool(
    "get_context",
    {
      description:
        "Read the shared context note of the whole job search. Read it at the start of every session " +
        "and take it into account. Returns { content, updatedAt }. Remember the updatedAt version so " +
        "update_context can guard against overwriting concurrent changes.",
    },
    undefined,
    () =>
      api.request<ApiContext>("GET", "/api/context").then((result) => {
        knownContextUpdatedAt = result.updatedAt;
        return result;
      }),
    { readOnlyHint: true },
  );

  tool(
    "update_context",
    {
      description:
        "REPLACE the whole shared context note (100000 chars max). Read get_context first, then rewrite the " +
        "full content preserving everything still relevant. Never log chatter or temporary details, only " +
        "durable facts: target roles, preferences, strategy, decisions. The write is checked automatically " +
        "against the version returned by the last get_context: it fails fast with CONFLICT (and forgets the " +
        "remembered version) when the note changed meanwhile, so no protocol parameter is needed.",
    },
    contextUpdateShape,
    (args: { content: string }) => {
      if (knownContextUpdatedAt === undefined) {
        throw new ToolRejection(
          "Call get_context first so you don't overwrite changes you haven't seen.",
          "READ_REQUIRED",
        );
      }

      return api
        .request<ApiContext>("PUT", "/api/context", {
          body: { content: args.content, expectedUpdatedAt: knownContextUpdatedAt },
        })
        .then((result) => {
          knownContextUpdatedAt = result.updatedAt;
          return result;
        })
        .catch((cause) => {
          if (cause instanceof ApiCallError && cause.code === "CONFLICT") {
            knownContextUpdatedAt = undefined;
            throw new ToolRejection(
              "The context changed since you last read it. Call get_context again, merge your changes, and retry.",
              "CONFLICT",
            );
          }
          throw cause;
        });
    },
  );

  return server;
}
