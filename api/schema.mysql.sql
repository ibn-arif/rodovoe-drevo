-- Родовое древо: схема для MySQL / MariaDB. Применяется автоматически при первом запросе к API.
-- Время хранится строкой ISO 8601 в UTC (одинаково для MySQL и SQLite, сравнивается как строка).
CREATE TABLE IF NOT EXISTS trees (
  id          CHAR(36) NOT NULL PRIMARY KEY,
  title       VARCHAR(200) NOT NULL,
  root_id     CHAR(36) NULL,
  version     BIGINT NOT NULL DEFAULT 0,
  is_example  TINYINT NOT NULL DEFAULT 0,
  created_at  VARCHAR(30) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Хэши всех ссылок в одной таблице: один хэш не может принадлежать двум древам или ролям.
CREATE TABLE IF NOT EXISTS tree_tokens (
  hash     CHAR(64) NOT NULL PRIMARY KEY,
  tree_id  CHAR(36) NOT NULL,
  role     VARCHAR(8) NOT NULL,
  INDEX tree_tokens_tree (tree_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS people (
  id          CHAR(36) NOT NULL PRIMARY KEY,
  tree_id     CHAR(36) NOT NULL,
  parent_id   CHAR(36) NULL,
  pos         INT NOT NULL DEFAULT 0,
  name        VARCHAR(400) NOT NULL,
  spouse      VARCHAR(400) NOT NULL DEFAULT '',
  deleted_by  BIGINT NULL,
  updated_by  VARCHAR(400) NOT NULL DEFAULT '',
  updated_at  VARCHAR(30) NOT NULL,
  INDEX people_tree (tree_id),
  INDEX people_parent (parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS marriages (
  id          CHAR(36) NOT NULL PRIMARY KEY,
  tree_id     CHAR(36) NOT NULL,
  a_id        CHAR(36) NOT NULL,
  b_id        CHAR(36) NOT NULL,
  deleted_by  BIGINT NULL,
  INDEX marriages_tree (tree_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS saves (
  id            BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tree_id       CHAR(36) NOT NULL,
  author        VARCHAR(400) NOT NULL,
  version       BIGINT NOT NULL,
  created_at    VARCHAR(30) NOT NULL,
  reverts_save  BIGINT NULL,
  reverts_edit  BIGINT NULL,
  INDEX saves_tree (tree_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS edits (
  id           BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  save_id      BIGINT NOT NULL,
  op_type      VARCHAR(20) NOT NULL,
  op           MEDIUMTEXT NOT NULL,
  before_json  MEDIUMTEXT NULL,
  after_json   MEDIUMTEXT NULL,
  reverted_by  BIGINT NULL,
  INDEX edits_save (save_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Кого затронула правка (для конфликтов и предупреждений при откате).
CREATE TABLE IF NOT EXISTS edit_people (
  person_id  CHAR(36) NOT NULL,
  edit_id    BIGINT NOT NULL,
  PRIMARY KEY (person_id, edit_id),
  INDEX edit_people_edit (edit_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS save_log (
  ip  VARCHAR(64) NOT NULL,
  at  VARCHAR(30) NOT NULL,
  INDEX save_log_ip (ip, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tree_creations (
  ip  VARCHAR(64) NOT NULL,
  at  VARCHAR(30) NOT NULL,
  INDEX tree_creations_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
