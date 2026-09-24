CREATE TABLE companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  website TEXT,
  location TEXT,
  description TEXT NOT NULL DEFAULT '',
  ai_context TEXT NOT NULL DEFAULT '',
  urls TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE postings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'saved' CHECK(state IN ('saved','applied','screening','interview','offer','rejected','withdrawn','ghosted')),
  applied_date TEXT,
  description TEXT NOT NULL DEFAULT '',
  ai_context TEXT NOT NULL DEFAULT '',
  urls TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_postings_company_id ON postings(company_id);
CREATE INDEX idx_postings_state ON postings(state);
