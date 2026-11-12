-- Та же схема для SQLite (тесты).
CREATE TABLE IF NOT EXISTS trees (id TEXT PRIMARY KEY, title TEXT NOT NULL, root_id TEXT, version INTEGER NOT NULL DEFAULT 0,
  is_example INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tree_tokens (hash TEXT PRIMARY KEY, tree_id TEXT NOT NULL, role TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS tree_tokens_tree ON tree_tokens(tree_id);
CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, tree_id TEXT NOT NULL, parent_id TEXT, pos INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL, spouse TEXT NOT NULL DEFAULT '', deleted_by INTEGER, updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS people_tree ON people(tree_id);
CREATE INDEX IF NOT EXISTS people_parent ON people(parent_id);
CREATE TABLE IF NOT EXISTS marriages (id TEXT PRIMARY KEY, tree_id TEXT NOT NULL, a_id TEXT NOT NULL, b_id TEXT NOT NULL, deleted_by INTEGER);
CREATE INDEX IF NOT EXISTS marriages_tree ON marriages(tree_id);
CREATE TABLE IF NOT EXISTS saves (id INTEGER PRIMARY KEY AUTOINCREMENT, tree_id TEXT NOT NULL, author TEXT NOT NULL, version INTEGER NOT NULL,
  created_at TEXT NOT NULL, reverts_save INTEGER, reverts_edit INTEGER);
CREATE INDEX IF NOT EXISTS saves_tree ON saves(tree_id, id);
CREATE TABLE IF NOT EXISTS edits (id INTEGER PRIMARY KEY AUTOINCREMENT, save_id INTEGER NOT NULL, op_type TEXT NOT NULL, op TEXT NOT NULL,
  before_json TEXT, after_json TEXT, reverted_by INTEGER);
CREATE INDEX IF NOT EXISTS edits_save ON edits(save_id);
CREATE TABLE IF NOT EXISTS edit_people (person_id TEXT NOT NULL, edit_id INTEGER NOT NULL, PRIMARY KEY (person_id, edit_id));
CREATE INDEX IF NOT EXISTS edit_people_edit ON edit_people(edit_id);
CREATE TABLE IF NOT EXISTS save_log (ip TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS save_log_ip ON save_log(ip, at);
CREATE TABLE IF NOT EXISTS tree_creations (ip TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS tree_creations_at ON tree_creations(at);
