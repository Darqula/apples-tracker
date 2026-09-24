# Apples Tracker

A small, single-user app for tracking job applications and the companies behind them,
entirely vibecoded. Runs locally, no auth, no cloud. Data lives in one SQLite file. Humans use the
web UI; AI assistants use an HTTP API (OpenAPI spec) or an MCP server over the same data.

## Goals

- One place to see every posting I applied to, its state, and the details I need.
- Jump between a company and its postings (and back) in one click.
- Fast to use: quick add, inline search, minimal fields required.
- AI-friendly: an assistant can read and update the data without scraping the UI.
- Zero operational burden: `npm install && npm run dev`, one DB file to back up.

## Features

- **Postings tab** — table: company, title, date applied, state, description (short), URLs.
  Filter by state; a row click opens a details panel with Edit and Delete buttons.
  **Group by** selector: *None*, *Company* (groups A→Z) or *State* (groups ordered by
  stage, most advanced first). Groups have collapsible headers with a row count; within
  a group rows are sorted by date applied, newest first.
- **Companies tab** — table: name, website, location, description, number of postings, URLs.
- **Cross-references** — company cell in postings links to the company; company row
  shows/links its postings (filtered postings view). Postings link back to the company.
- **Forms** — add / update / delete for both entities (modal or side panel). Creating a
  posting lets me pick an existing company or create one inline.
- **Search** — one search box per tab: postings match job title or company name;
  companies match name. Descriptions and AI context are deliberately not searched.
- **AI Context tab** — one editable text area holding shared memory for the whole job
  search (target roles, CV highlights, preferences, current strategy, open questions).
  Assistants read it at the start of a session and update it as things change.
- **MCP server (primary AI interface)** — tools for search/get/create/update/delete of
  postings and companies, plus read/update of the shared context. Ships usage
  instructions to the model (see "AI usage guide").
- **REST API + spec (secondary)** — JSON API with an OpenAPI 3 document at
  `/openapi.json` (Swagger UI at `/docs`), for scripts and non-MCP assistants.
- **Storage** — SQLite, single file (`data/apples.db`), created and migrated on startup.

## Stack

- Node.js 22+, TypeScript, npm workspaces
- Server: Fastify + `better-sqlite3`, JSON-schema validation, `@fastify/swagger`
- Web: React + Vite + TypeScript, TanStack Table (and TanStack Query for fetching)
- MCP: `@modelcontextprotocol/sdk`, stdio transport, thin wrapper over the REST API
- Tests: Vitest (server API and MCP tests against in-memory SQLite, web unit tests) and
  Playwright end-to-end tests (`npm run test:e2e`)

## Data model

**companies**: `id`, `name` (unique, case-insensitive), `website`, `location`, `description`, `ai_context`,
`urls` (JSON array of strings), `created_at`, `updated_at`

**postings**: `id`, `company_id` (FK → companies), `title`, `state`, `applied_date`
(ISO date, nullable), `description` (free text), `ai_context` (free text), `urls` (JSON array), `created_at`, `updated_at`

`description` is the human-readable summary shown in the tables. `ai_context` is extra
free-text meant for AI models (e.g. my CV-fit notes, interview prep, tone or constraints
for drafting messages). It is returned by the API and MCP tools, editable in the forms,
and not shown in the tables.

**context** (singleton, one row): `content` (free text, Markdown), `updated_at`. This is
the shared memory for the current job search, separate from the per-record `ai_context`.

`state` is one of: `saved`, `applied`, `screening`, `interview`, `offer`, `rejected`,
`withdrawn`, `ghosted`.

**Stage order** (used for grouping/sorting by state, top to bottom): `offer` →
`interview` → `screening` → `applied` → `saved` → then the closed states `rejected` →
`withdrawn` → `ghosted`. Active processes always sit above closed ones. The order is
defined once in `schemas.ts` and shared by the API and UI.

Deleting a company that still has postings is refused (`409`) unless `?cascade=true`
is passed; the UI asks for confirmation first.

## API summary

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/postings` | list supports `q`, `state`, `companyId`, `sort` (incl. `stage`, `company`), `limit`, `offset` |
| GET/PATCH/DELETE | `/api/postings/:id` | GET includes the embedded company |
| GET/POST | `/api/companies` | list supports `q`, `sort`, includes `postingCount` |
| GET/PATCH/DELETE | `/api/companies/:id` | GET includes its postings; DELETE accepts `cascade` |
| GET/PUT | `/api/context` | shared job-search memory; PUT replaces `content` |
| GET | `/api/guide` | the AI usage guide as Markdown |

Errors: `{ "error": { "code", "message" } }` with 400/404/409 status codes.
The server binds to `127.0.0.1` only.

## MCP tools

`search_postings`, `get_posting`, `create_posting`, `update_posting`, `delete_posting`,
`search_companies`, `get_company`, `create_company`, `update_company`, `delete_company`,
`get_context`, `update_context`. Tool schemas mirror the API. `create_posting` and
`update_posting` accept `companyName` and create the company if missing, so an assistant
needs only one call.

Built-in safeguards: delete tools refuse unless called with `confirm: true` (the guide
tells the model to ask you first); `update_context` refuses until `get_context` has been
called and rejects the write if the note changed since (no blind overwrites); search
results are compact and omit `aiContext` (use `get_posting` / `get_company` for it).

## AI usage guide

A single Markdown file, `server/src/ai-guide.md`, is the source of truth for instructing
models. It is delivered three ways: as the MCP server `instructions` (sent on connect),
as the MCP resource `apples://guide`, and at `GET /api/guide` for REST clients. It covers:

1. Start every session by calling `get_context`; end it by updating context if something
   durable changed (do not log chatter).
2. Field semantics: `description` (human summary) vs record `ai_context` (model notes)
   vs the global context.
3. Search before creating, to avoid duplicate companies; use exact `state` values.
4. Prefer `update_*` over delete; deletes need explicit user confirmation.
5. Update `ai_context` by reading the current value first and rewriting it in full.
6. Dates are ISO `YYYY-MM-DD`; URLs are full `https://` links.

## Run

```
npm install
npm run dev      # development: API on :3001, web (hot reload) on :5173
npm run seed     # optional demo data (add `-- --reset` to wipe first)
npm test         # unit tests; `npm run test:e2e` runs the browser tests

npm run build && npm start   # single process: API + UI at http://127.0.0.1:3001
```

Data lives in `data/apples.db` (override with `DB_PATH`); back it up by copying the file.

**Connect an AI assistant (MCP).** The API must be running (`npm run dev` or `npm start`).
Claude Code:

```
claude mcp add apples-tracker -- npm run mcp --prefix <repo path>
```

or any MCP client config: command `npm`, args `["run","mcp","--prefix","<repo path>"]`,
where `<repo path>` is the absolute path of this repository.
Set `APPLES_API_URL` if the API is not at `http://127.0.0.1:3001`.
