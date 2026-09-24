CREATE TABLE context (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  content TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO context(id) VALUES (1);
