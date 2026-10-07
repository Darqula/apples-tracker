CREATE TABLE company_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE company_list_members (
  list_id INTEGER NOT NULL REFERENCES company_lists(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  PRIMARY KEY (list_id, company_id)
);

CREATE INDEX idx_company_list_members_company_id ON company_list_members(company_id);

CREATE TABLE posting_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE posting_list_members (
  list_id INTEGER NOT NULL REFERENCES posting_lists(id) ON DELETE CASCADE,
  posting_id INTEGER NOT NULL REFERENCES postings(id) ON DELETE CASCADE,
  PRIMARY KEY (list_id, posting_id)
);

CREATE INDEX idx_posting_list_members_posting_id ON posting_list_members(posting_id);
