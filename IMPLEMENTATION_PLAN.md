# Implementation Plan

**Status: checkpoints 0–7 are implemented and reviewed; Playwright e2e tests are the last addition.** Each checkpoint ends in a working, testable state and gets its own commit. Delegate the
bulk code writing to `cheap-coder` (model `opencode-go/glm-5.3-flash`); review every diff.

## Repo layout

```
apples-tracker/
  package.json            # npm workspaces: server, web; scripts dev/build/start/test/seed/mcp
  server/
    src/
      index.ts            # start Fastify, bind 127.0.0.1
      app.ts              # buildApp(db, {webDist}) -> Fastify instance (used by tests)
      db.ts               # open DB, run migrations
      migrations/         # 001_init.sql, 002_context.sql
      routes/             # companies.ts, postings.ts, context.ts (+ /api/guide)
      schemas.ts          # JSON schemas (validation + OpenAPI), STATES, STAGE_ORDER
      openapi.ts          # @fastify/swagger + swagger-ui
      ai-guide.md         # usage guide for AI assistants (single source of truth)
      mcp/                # api-client.ts, server.ts (12 tools + guide resource)
      mcp-stdio.ts        # MCP stdio entry point (env APPLES_API_URL)
      seed.ts             # demo data
    test/                 # Vitest tests (in-memory SQLite)
  web/
    src/
      api.ts, hash.ts, forms.ts, grouping.ts, contextState.ts   # pure/typed helpers (unit-tested)
      App.tsx             # tabs (hash routing)
      pages/              # PostingsPage, CompaniesPage, ContextPage
      components/         # DataTable, Modal, ConfirmDialog, PostingForm, CompanyForm, SearchBox, UrlList
  e2e/                    # Playwright end-to-end tests
  data/                   # apples.db (gitignored)
```

## Checkpoint 0 — Scaffold

- Root `package.json` with workspaces, `.gitignore` (`node_modules`, `data/`, `dist`).
- `server/` (TypeScript, tsx for dev, Vitest) and `web/` (Vite React TS template).
- Vite dev proxy: `/api` → `http://127.0.0.1:3001`.
- Root scripts: `dev` (both, via `concurrently`), `test`, `build`.
- **Done when:** `npm run dev` shows a blank React page and `GET /api/health` returns ok.

## Checkpoint 1 — Database and companies API

- `db.ts`: open `data/apples.db` (path overridable by `DB_PATH`, `:memory:` in tests),
  `PRAGMA foreign_keys=ON`, `journal_mode=WAL`, apply numbered SQL migrations tracked
  via `PRAGMA user_version`.
- `001_init.sql`: `companies` and `postings` tables, `UNIQUE(name COLLATE NOCASE)`,
  `description TEXT` and `ai_context TEXT` on both tables (nullable, default empty),
  `CHECK(state IN (...))`, index on `postings(company_id)` and `postings(state)`.
- Companies routes: list (`q`, `sort`, `postingCount`), get (with postings), create,
  patch, delete (409 unless `cascade=true`).
- Vitest tests: CRUD, duplicate name → 409, delete guard and cascade, validation → 400.
- **Done when:** tests pass; manual `curl` CRUD works.

## Checkpoint 2 — Postings API

- Routes: list (`q` over title and company name, `state`, `companyId`, `sort`, paging),
  get (embedded company), create, patch, delete.
- Create accepts `companyId` **or** `companyName` (find-or-create, case-insensitive).
- `urls` stored as JSON array; validated as array of URL strings; returned parsed.
- `updated_at` refreshed on every patch.
- `sort` supports `stage` (custom CASE order, shared `STAGE_ORDER` constant from
  `schemas.ts`) and `company` (name NOCASE), with `applied_date` desc as tiebreaker.
- Tests: `sort=stage` and `sort=company` ordering, search matches title and company, state filter, find-or-create company,
  bad `companyId` → 400/404, patch semantics.
- **Done when:** all API tests pass.

## Checkpoint 2b — Shared context and AI guide

- Migration `002_context.sql`: `context(id INTEGER PRIMARY KEY CHECK(id=1), content TEXT
  NOT NULL DEFAULT '', updated_at)`; insert the single row at migration time.
- Routes: `GET /api/context`, `PUT /api/context` (`{content}` replaces the text).
- Write `server/src/ai-guide.md` (points 1–6 in the README) and serve it at `GET /api/guide`
  as `text/markdown`.
- Tests: context read/update round-trip, guide endpoint returns non-empty Markdown.
- **Done when:** tests pass.

## Checkpoint 3 — OpenAPI spec

- Register `@fastify/swagger` + `@fastify/swagger-ui`; route schemas already carry
  request/response shapes. Serve `/openapi.json` and `/docs`.
- Add descriptions and examples so an AI can use the spec without guessing; REST is the
  secondary AI interface (MCP is primary, see checkpoint 6).
- Search (`q`) must not touch `description` or `ai_context` — state this in the spec.
- Test: spec loads, contains all paths, and validates as OpenAPI 3.
- **Done when:** `/docs` renders and lists every endpoint.

## Checkpoint 4 — Web: tables and cross-references

- `api.ts` typed client; TanStack Query for fetching and invalidation.
- `App.tsx`: two tabs (Postings, Companies), current tab and filters kept in the URL
  hash so links and refresh work.
- `DataTable` (TanStack Table): sortable columns, empty and loading states.
- Postings table: company (link), title, applied date, state badge, description (truncated),
  URLs (clickable, open in new tab). State filter dropdown and search box (debounced).
- Grouping: "Group by" control (None / Company / State) stored in the URL hash.
  Done client-side on the fetched list (personal-scale data). Company groups sort by
  name case-insensitively A→Z; state groups follow the stage order (`offer`,
  `interview`, `screening`, `applied`, `saved`, `rejected`, `withdrawn`, `ghosted`) and
  empty groups are hidden. Rows inside groups sort by `applied_date` desc (nulls last).
  Group headers show name, count, and collapse/expand; collapsed state is kept while
  filtering. Grouping combines with search and the state filter.
- Companies table: name, website, location, description, posting count (link), URLs.
- Cross-references: company link → Companies tab with that company selected; posting
  count link → Postings tab filtered by `companyId` (shown as a removable filter chip).
- **Done when:** seeded data shows in both tabs and every cross-link navigates correctly.

## Checkpoint 4b — Web: AI Context tab

- Third tab with a large Markdown text area bound to `/api/context`, explicit Save
  button, "last updated" timestamp, and an unsaved-changes warning.
- Warn on save if the server copy changed since load (compare `updated_at`), since an
  assistant may have edited it meanwhile.
- **Done when:** edits made in the UI are visible via the API and vice versa.

## Checkpoint 5 — Web: forms

- Side panel or modal for create/edit; delete with confirmation.
- `PostingForm`: title, state, applied date, description, AI context, URLs (add/remove rows), company
  combobox with "create new company" inline.
- `CompanyForm`: name, website, location, description, AI context, URLs; shows the company's postings.
  Delete with postings warns and passes `cascade=true` only after confirmation.
- Show API validation errors next to the fields; refresh tables after every mutation.
- **Done when:** the full add → edit → delete flow works for both entities from the UI.

## Checkpoint 6 — MCP server (primary AI interface)

- `server/src/mcp/` (`server.ts`, `api-client.ts`) with entry point `server/src/mcp-stdio.ts` using `@modelcontextprotocol/sdk` over stdio; calls the REST API
  at `APPLES_API_URL` (default `http://127.0.0.1:3001`) so there is one source of truth.
- Tools as listed in the README (including `get_context` / `update_context`, which remembers the version last read and refuses blind or stale writes; delete tools require `confirm: true`; search results omit `aiContext`); concise
  descriptions that state when to use each tool, input schemas reused from `schemas.ts`;
  errors returned as tool errors with the API message.
- Pass the contents of `ai-guide.md` as the server `instructions` and expose it as the
  resource `apples://guide`. Tool descriptions repeat only the critical rules (search
  before create, confirm before delete).
- Optional later: also serve MCP over Streamable HTTP at `/mcp` for clients that cannot
  spawn stdio processes.
- Document Claude Code / Claude Desktop config snippet in the README.
- Test: spawn the server against a test API instance and call each tool.
- **Done when:** an MCP client can search, create, update, and delete through the tools.

## Checkpoint 7 — Polish

- Seed script (`npm run seed`) with sample data for demos.
- Keyboard: `/` focuses search, `n` opens the new-item form.
- Backup note in README (copy `data/apples.db`); optional CSV export endpoint.
- Production build: `npm run build` and Fastify serves `web/dist`, so one process runs
  the whole app (`npm start`).
- **Done when:** a fresh clone can be built and started with two commands.

## Decisions to keep simple

- No auth; bind to localhost only.
- No ORM: plain SQL with `better-sqlite3` prepared statements.
- URLs as JSON arrays, not separate tables — revisit only if querying by URL is needed.
- Hard deletes, no history.

## Risks

- `better-sqlite3` needs a prebuilt binary or a compiler toolchain on Windows; use a
  Node LTS release that has prebuilds.
- Keep API, OpenAPI spec, and MCP schemas generated from one `schemas.ts` to avoid drift.
