// Typed client for the JSON API served by the Fastify server (see
// server/src/routes/*.ts and server/src/schemas.ts).

export const STATES = [
  "saved",
  "applied",
  "screening",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
  "ghosted",
] as const;

export type State = (typeof STATES)[number];

// Most advanced stage first — same order as server/src/schemas.ts.
export const STAGE_ORDER: readonly State[] = [
  "offer",
  "interview",
  "screening",
  "applied",
  "saved",
  "rejected",
  "withdrawn",
  "ghosted",
];

// A list a company/posting belongs to (as embedded in API responses).
export interface ListRef {
  id: number;
  name: string;
}

// Company lists and posting lists are two independent sets of named groups.
export type ListKind = "company" | "posting";

// A user-defined list as returned by GET /api/{company,posting}-lists.
export interface ListItem {
  id: number;
  name: string;
  memberCount: number;
  createdAt: string;
}

export interface Company {
  id: number;
  name: string;
  website: string | null;
  location: string | null;
  description: string;
  aiContext: string;
  urls: string[];
  postingCount: number;
  lists: ListRef[];
  createdAt: string;
  updatedAt: string;
}

export interface CompanyPostingSummary {
  id: number;
  title: string;
  state: State;
  appliedDate: string | null;
}

export interface CompanyDetail extends Company {
  postings: CompanyPostingSummary[];
}

export interface CompanyRef {
  id: number;
  name: string;
}

export interface Posting {
  id: number;
  companyId: number;
  company: CompanyRef;
  title: string;
  state: State;
  appliedDate: string | null;
  description: string;
  aiContext: string;
  urls: string[];
  lists: ListRef[];
  createdAt: string;
  updatedAt: string;
}

// Thrown by request() for every non-2xx response.
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export type CompanySort = "name" | "-name" | "created" | "-created";

export type PostingSort = "stage" | "company" | "applied" | "-applied" | "title" | "updated";

export interface ListCompaniesParams {
  q?: string;
  listId?: number;
  sort?: CompanySort;
  limit?: number;
  offset?: number;
}

export interface ListPostingsParams {
  q?: string;
  state?: State;
  companyId?: number;
  listId?: number;
  sort?: PostingSort;
  limit?: number;
  offset?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
}

// The one shared context note (GET/PUT /api/context).
export interface ContextNote {
  content: string;
  updatedAt: string;
}

interface ErrorBody {
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

function extractError(body: unknown): { code: string; message: string } {
  const errorBody = body as ErrorBody | undefined;
  const error = typeof errorBody === "object" && errorBody !== null ? errorBody.error : undefined;
  if (error && typeof error.code === "string" && typeof error.message === "string") {
    return { code: error.code, message: error.message };
  }
  return { code: "UNKNOWN", message: "Request failed" };
}

export interface CompanyInput {
  name: string;
  website: string | null;
  location: string | null;
  description: string;
  aiContext: string;
  urls: string[];
  // Replaces the whole set of lists when present; omitted = unchanged.
  listIds?: number[];
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let bodyText: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    bodyText = JSON.stringify(options.body);
  }

  const res = await fetch(path, { method: options.method ?? "GET", headers, body: bodyText });

  // 204 with an empty body must not go through response.json().
  if (res.status === 204) {
    return undefined as T;
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }

  if (!res.ok) {
    const { code, message } = extractError(body);
    throw new ApiError(code, message, res.status);
  }

  return body as T;
}

function toQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function listCompanies(params: ListCompaniesParams = {}): Promise<Page<Company>> {
  return request<Page<Company>>(
    `/api/companies${toQueryString({
      q: params.q,
      listId: params.listId,
      sort: params.sort,
      limit: params.limit,
      offset: params.offset,
    })}`,
  );
}

export function getCompany(id: number): Promise<CompanyDetail> {
  return request<CompanyDetail>(`/api/companies/${encodeURIComponent(String(id))}`);
}

export function listPostings(params: ListPostingsParams = {}): Promise<Page<Posting>> {
  return request<Page<Posting>>(
    `/api/postings${toQueryString({
      q: params.q,
      state: params.state,
      companyId: params.companyId,
      listId: params.listId,
      sort: params.sort,
      limit: params.limit,
      offset: params.offset,
    })}`,
  );
}

export function getContext(): Promise<ContextNote> {
  return request<ContextNote>("/api/context");
}

// The server refuses the write with a 409 CONFLICT ApiError when the note
// changed since `expectedUpdatedAt` was fetched, and with a 422 SHRINK_GUARD
// ApiError when it would cut a long note below half its length (unless `force`).
export function updateContext(
  content: string,
  expectedUpdatedAt: string,
  force = false,
): Promise<ContextNote> {
  return request<ContextNote>("/api/context", {
    method: "PUT",
    body: force ? { content, expectedUpdatedAt, force } : { content, expectedUpdatedAt },
  });
}

// Earlier versions of the context note (every overwrite keeps the old one).
export interface ContextVersionSummary {
  id: number;
  updatedAt: string; // when this version was written
  replacedAt: string; // when it was overwritten
  length: number;
}

export interface ContextVersion {
  id: number;
  content: string;
  updatedAt: string;
  replacedAt: string;
}

export async function listContextHistory(): Promise<ContextVersionSummary[]> {
  const body = await request<{ items: ContextVersionSummary[] }>("/api/context/history");
  return body.items;
}

export function getContextVersion(id: number): Promise<ContextVersion> {
  return request<ContextVersion>(`/api/context/history/${encodeURIComponent(String(id))}`);
}

export function createCompany(input: CompanyInput): Promise<Company> {
  return request<Company>("/api/companies", { method: "POST", body: input });
}

// The server accepts any subset of CompanyInput (at least one field) for
// PATCH; website/location may be explicitly null to clear them.
export function updateCompany(id: number, patch: Partial<CompanyInput>): Promise<Company> {
  return request<Company>(`/api/companies/${encodeURIComponent(String(id))}`, {
    method: "PATCH",
    body: patch,
  });
}

// Refuses with a 409 CONFLICT ApiError when the company still has postings
// and `cascade` is not true.
export function deleteCompany(id: number, cascade = false): Promise<void> {
  return request<void>(
    `/api/companies/${encodeURIComponent(String(id))}${cascade ? "?cascade=true" : ""}`,
    { method: "DELETE" },
  );
}

export interface PostingInput
  extends Omit<CompanyInput, "name" | "website" | "location"> {
  title: string;
  state: State;
  // 'YYYY-MM-DD' or null.
  appliedDate: string | null;
  // Exactly one company reference: an existing company id XOR a new
  // (find-or-create, case-insensitive) company name.
  companyId?: number;
  companyName?: string;
}

// The server accepts any non-empty subset of PostingInput for PATCH, but
// only `companyId` — not `companyName` — so patch types must not carry it.
export type PostingPatch = Partial<
  Pick<PostingInput, "title" | "state" | "appliedDate" | "description" | "aiContext" | "urls" | "listIds">
> & { companyId?: number };

export function createPosting(input: PostingInput): Promise<Posting> {
  return request<Posting>("/api/postings", { method: "POST", body: input });
}

export function updatePosting(id: number, patch: PostingPatch): Promise<Posting> {
  return request<Posting>(`/api/postings/${encodeURIComponent(String(id))}`, {
    method: "PATCH",
    body: patch,
  });
}

export function deletePosting(id: number): Promise<void> {
  return request<void>(`/api/postings/${encodeURIComponent(String(id))}`, {
    method: "DELETE",
  });
}

const listsPath = (kind: ListKind) => (kind === "company" ? "/api/company-lists" : "/api/posting-lists");

export function listLists(kind: ListKind): Promise<Page<ListItem>> {
  return request<Page<ListItem>>(listsPath(kind));
}

// Rejects with a 409 CONFLICT ApiError when the name already exists (case-insensitively).
export function createList(kind: ListKind, name: string): Promise<ListItem> {
  return request<ListItem>(listsPath(kind), { method: "POST", body: { name } });
}

export function renameList(kind: ListKind, id: number, name: string): Promise<ListItem> {
  return request<ListItem>(`${listsPath(kind)}/${encodeURIComponent(String(id))}`, {
    method: "PATCH",
    body: { name },
  });
}

// Only the list is removed; its companies/postings stay.
export function deleteList(kind: ListKind, id: number): Promise<void> {
  return request<void>(`${listsPath(kind)}/${encodeURIComponent(String(id))}`, { method: "DELETE" });
}
