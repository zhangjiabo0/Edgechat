PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS channels_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  avatar_key TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('public', 'private', 'dm')),
  dm_key TEXT UNIQUE,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

INSERT INTO channels_new (id, name, description, avatar_key, kind, dm_key, created_by, created_at, deleted_at)
SELECT id, name, description, avatar_key, kind, dm_key, created_by, created_at, deleted_at FROM channels;

DROP TABLE channels;

ALTER TABLE channels_new RENAME TO channels;

PRAGMA foreign_keys = ON;
