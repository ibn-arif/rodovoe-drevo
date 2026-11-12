<?php
// Логика родового древа: роли по ссылке, сохранение черновика, конфликты, история, откат, старшинство, лимиты.
// Перенесена с функций Postgres один к одному: те же правила и коды ошибок.
// Работает с MySQL/MariaDB (хостинг) и SQLite (тесты) через PDO; SQL без особенностей одной из баз.
declare(strict_types=1);

final class ApiError extends Exception {}

function fail(string $code): never { throw new ApiError($code); }

// Подключение: в тестах — DREVO_DSN (SQLite), на хостинге — файл доступа вне корня сайта.
function drevo_connect(): PDO {
  $dsn = getenv('DREVO_DSN') ?: '';
  $user = null; $pass = null;
  if ($dsn === '') {
    $cfg = require dirname(__DIR__, 2) . '/pamyat-roda.config.php';
    [$dsn, $user, $pass] = [$cfg['dsn'], $cfg['user'], $cfg['pass']];
  }
  $db = new PDO($dsn, $user, $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
  $mysql = $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
  if ($mysql) $db->exec("SET NAMES utf8mb4");
  else $db->exec('PRAGMA busy_timeout = 5000');
  try { $db->query('SELECT 1 FROM trees LIMIT 1'); }
  catch (PDOException) { $db->exec(file_get_contents(__DIR__ . ($mysql ? '/schema.mysql.sql' : '/schema.sqlite.sql'))); }
  return $db;
}

// Адрес посетителя для лимитов. Подделать его заголовками нельзя: доверяем только прокси на этом же сервере.
function drevo_client_ip(): string {
  if (getenv('DREVO_TEST') === '1' && !empty($_SERVER['HTTP_X_TEST_IP'])) return substr((string)$_SERVER['HTTP_X_TEST_IP'], 0, 64);
  $ip = (string)($_SERVER['REMOTE_ADDR'] ?? 'local');
  if (in_array($ip, ['127.0.0.1', '::1'], true) && !empty($_SERVER['HTTP_X_REAL_IP'])) $ip = (string)$_SERVER['HTTP_X_REAL_IP'];
  return substr($ip, 0, 64);
}

final class Drevo {
  private const PUBLIC = ['ping', 'create_tree', 'open_tree', 'tree_version', 'save_changes', 'revert', 'get_history', 'deleted_items', 'delete_tree'];
  private const EDGE = '/^[ \t\x{00a0}\x{200b}-\x{200d}\x{2060}\x{feff}]+|[ \t\x{00a0}\x{200b}-\x{200d}\x{2060}\x{feff}]+$/u';
  private bool $mysql;

  public function __construct(private PDO $db, private string $ip) {
    $this->mysql = $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
  }

  public function call(string $fn, array $args): mixed {
    if (!in_array($fn, self::PUBLIC, true)) fail('bad_request');
    return $this->$fn(...$args);
  }

  // ── помощники ────────────────────────────────────────────────────────

  private static function now(int $ago = 0): string {
    $t = microtime(true) - $ago;
    return gmdate('Y-m-d\TH:i:s', (int)$t) . sprintf('.%03dZ', (int)(($t - floor($t)) * 1000));
  }
  private static function hash(?string $t): string { return hash('sha256', (string)$t); }
  private static function uuid(): string {
    $b = random_bytes(16); $b[6] = chr(ord($b[6]) & 0x0f | 0x40); $b[8] = chr(ord($b[8]) & 0x3f | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
  }
  private static function uuidOf(array $op, string $k): string {
    $v = $op[$k] ?? null;
    if (!is_string($v) || !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $v)) fail('bad_op');
    return strtolower($v);
  }
  private static function len(string $s): int { return preg_match_all('/./su', $s); }

  // Имя: края без пробелов и невидимых символов, 1..100 символов, без управляющих, хотя бы один видимый.
  private static function cleanName(mixed $p): string {
    if (!is_string($p) && $p !== null) fail('bad_name');
    $s = preg_replace(self::EDGE, '', (string)$p);
    if ($s === null || $s === '' || self::len($s) > 100 || preg_match('/[\x{0001}-\x{001f}\x{007f}\x{2028}\x{2029}]/u', $s)
        || !preg_match('/[^ \t\x{00a0}\x{200b}-\x{200f}\x{2060}-\x{2064}\x{feff}]/u', $s)) fail('bad_name');
    return $s;
  }
  private static function cleanSpouse(mixed $p): string {
    return trim((string)($p ?? ''), " \t") === '' ? '' : self::cleanName($p);
  }

  private function q(string $sql, array $args = []): PDOStatement {
    $st = $this->db->prepare($sql); $st->execute($args); return $st;
  }
  private function one(string $sql, array $args = []): ?array { return $this->q($sql, $args)->fetch() ?: null; }
  private function val(string $sql, array $args = []): mixed { $v = $this->q($sql, $args)->fetchColumn(); return $v === false ? null : $v; }

  private function role(?string $token): array {
    $r = $this->one('SELECT tree_id, role FROM tree_tokens WHERE hash = ?', [self::hash($token)]);
    if (!$r) fail('tree_not_found');
    return $r;
  }

  // Транзакция с блокировкой древа: правки одного древа идут строго по очереди.
  private function tx(?string $treeId, callable $fn): mixed {
    if ($this->mysql) $this->db->beginTransaction(); else $this->db->exec('BEGIN IMMEDIATE');
    try {
      if ($treeId && $this->mysql) $this->q('SELECT id FROM trees WHERE id = ? FOR UPDATE', [$treeId]);
      $r = $fn();
      $this->mysql ? $this->db->commit() : $this->db->exec('COMMIT');
      return $r;
    } catch (Throwable $e) {
      $this->mysql ? $this->db->rollBack() : $this->db->exec('ROLLBACK');
      throw $e;
    }
  }

  private function alive(string $tree, string $id): array {
    $r = $this->one('SELECT * FROM people WHERE id = ? AND tree_id = ? AND deleted_by IS NULL', [$id, $tree]);
    if (!$r) fail('bad_op');
    return $r;
  }
  private static function person(array $p): array {
    return ['id' => $p['id'], 'parent_id' => $p['parent_id'], 'pos' => (int)$p['pos'], 'name' => $p['name'], 'spouse' => $p['spouse']];
  }
  private function nextPos(string $parent): int {
    return (int)$this->val('SELECT COALESCE(MAX(pos) + 1, 0) FROM people WHERE parent_id = ?', [$parent]);
  }
  // Вся ветка под человеком (вместе с ним). Обход с памятью — цикл в данных не зациклит сервер.
  private function branch(string $id, bool $aliveOnly): array {
    $seen = [$id => true]; $front = [$id];
    while ($front) {
      $in = implode(',', array_fill(0, count($front), '?'));
      $rows = $this->q("SELECT id FROM people WHERE parent_id IN ($in)" . ($aliveOnly ? ' AND deleted_by IS NULL' : ''), $front)->fetchAll(PDO::FETCH_COLUMN);
      $front = [];
      foreach ($rows as $r) if (!isset($seen[$r])) { $seen[$r] = true; $front[] = $r; }
    }
    return array_keys($seen);
  }
  private function root(string $tree): ?string { return $this->val('SELECT root_id FROM trees WHERE id = ?', [$tree]); }

  // ── публичные функции ────────────────────────────────────────────────

  public function ping(): int { return 1; }

  public function create_tree(mixed $title, mixed $rootName, mixed $oh, mixed $eh, mixed $vh): array {
    $name = self::cleanName($rootName);
    if ((int)$this->val('SELECT COUNT(*) FROM tree_creations WHERE ip = ? AND at > ?', [$this->ip, self::now(3600)]) >= 5
        || (int)$this->val('SELECT COUNT(*) FROM tree_creations WHERE at > ?', [self::now(86400)]) >= 2000) fail('too_many_trees');
    foreach ([$oh, $eh, $vh] as $x) if (!is_string($x) || !preg_match('/^[0-9a-f]{64}$/', $x)) fail('bad_token');
    if ($oh === $eh || $oh === $vh || $eh === $vh
        || $this->val('SELECT COUNT(*) FROM tree_tokens WHERE hash IN (?, ?, ?)', [$oh, $eh, $vh])) fail('bad_token');
    $title = trim(is_string($title) ? $title : '');
    if ($title === '') $title = 'Род ' . $name;
    $title = mb_substr($title, 0, 120);
    return $this->tx(null, function () use ($title, $name, $oh, $eh, $vh) {
      $tree = self::uuid(); $root = self::uuid(); $now = self::now();
      $this->q('INSERT INTO tree_creations (ip, at) VALUES (?, ?)', [$this->ip, $now]);
      $this->q('DELETE FROM tree_creations WHERE at < ?', [self::now(2 * 86400)]);
      $this->q('INSERT INTO trees (id, title, created_at) VALUES (?, ?, ?)', [$tree, $title, $now]);
      try {
        foreach (['owner' => $oh, 'edit' => $eh, 'view' => $vh] as $role => $hash)
          $this->q('INSERT INTO tree_tokens (hash, tree_id, role) VALUES (?, ?, ?)', [$hash, $tree, $role]);
      } catch (PDOException) { fail('bad_token'); }
      $this->q('INSERT INTO people (id, tree_id, name, updated_at) VALUES (?, ?, ?, ?)', [$root, $tree, $name, $now]);
      $this->q('UPDATE trees SET root_id = ? WHERE id = ?', [$root, $tree]);
      return ['tree_id' => $tree, 'root_id' => $root];
    });
  }

  public function open_tree(mixed $token): array {
    $r = $this->role(is_string($token) ? $token : null);
    $t = $this->one('SELECT * FROM trees WHERE id = ?', [$r['tree_id']]);
    $people = array_map(fn($p) => self::person($p) + ['updated_by' => $p['updated_by'], 'updated_at' => $p['updated_at']],
      $this->q('SELECT * FROM people WHERE tree_id = ? AND deleted_by IS NULL ORDER BY pos, id', [$t['id']])->fetchAll());
    $alive = array_flip(array_column($people, 'id'));
    $mar = [];
    foreach ($this->q('SELECT id, a_id, b_id FROM marriages WHERE tree_id = ? AND deleted_by IS NULL ORDER BY id', [$t['id']])->fetchAll() as $m)
      if (isset($alive[$m['a_id']], $alive[$m['b_id']])) $mar[] = $m;
    return ['tree_id' => $t['id'], 'title' => $t['title'], 'role' => $r['role'], 'root_id' => $t['root_id'],
      'version' => (int)$t['version'], 'is_example' => (bool)$t['is_example'], 'people' => $people, 'marriages' => $mar];
  }

  public function tree_version(mixed $token): int {
    $r = $this->role(is_string($token) ? $token : null);
    return (int)$this->val('SELECT version FROM trees WHERE id = ?', [$r['tree_id']]);
  }

  // Кого правка меняет напрямую (для конфликтов) и на кого опирается.
  private function targets(array $op): array {
    $c = []; $n = [];
    switch ($op['type'] ?? null) {
      case 'add_child': $n = [self::uuidOf($op, 'parent_id')]; break;
      case 'add_parent': $c = [self::uuidOf($op, 'child_id')]; break;
      case 'update': case 'delete': case 'reorder': $c = [self::uuidOf($op, 'person_id')]; break;
      case 'move': $c = [self::uuidOf($op, 'person_id')]; $n = [self::uuidOf($op, 'parent_id')]; break;
      case 'marry': $c = [self::uuidOf($op, 'a_id'), self::uuidOf($op, 'b_id')]; break;
      case 'unmarry':
        $m = $this->one('SELECT a_id, b_id FROM marriages WHERE id = ?', [self::uuidOf($op, 'marriage_id')]);
        if ($m) $c = [$m['a_id'], $m['b_id']];
        break;
    }
    return [$c, $n];
  }

  private function limitSaves(string $tree): void {
    if ((int)$this->val('SELECT COUNT(*) FROM saves WHERE tree_id = ? AND created_at > ?', [$tree, self::now(3600)]) >= 120
        || (int)$this->val('SELECT COUNT(*) FROM save_log WHERE ip = ? AND at > ?', [$this->ip, self::now(3600)]) >= 600) fail('too_many_saves');
    $this->q('INSERT INTO save_log (ip, at) VALUES (?, ?)', [$this->ip, self::now()]);
    $this->q('DELETE FROM save_log WHERE at < ?', [self::now(7200)]);
  }

  public function save_changes(mixed $token, mixed $author, mixed $base, mixed $ops, mixed $force = false): array {
    $r = $this->role(is_string($token) ? $token : null);
    if (!in_array($r['role'], ['owner', 'edit'], true)) fail('forbidden');
    $author = self::cleanName($author);
    if (!is_array($ops) || !array_is_list($ops) || !$ops) fail('bad_op');
    if (count($ops) > 5000 || strlen(json_encode($ops)) > 1_000_000) fail('too_large');
    foreach ($ops as $op) if (!is_array($op)) fail('bad_op');
    $base = (int)$base; $tree = $r['tree_id'];
    return $this->tx($tree, function () use ($tree, $author, $base, $ops, $force) {
      $this->limitSaves($tree);
      $new = []; $changed = []; $needed = [];
      foreach ($ops as $op) {
        if (in_array($op['type'] ?? null, ['add_child', 'add_parent', 'marry'], true)) $new[self::uuidOf($op, 'id')] = true;
        [$c, $n] = $this->targets($op);
        array_push($changed, ...$c); array_push($needed, ...$n);
      }
      if (!$force) {
        $conflicts = [];
        foreach (array_unique(array_merge($changed, $needed)) as $id) {
          if (isset($new[$id])) continue;
          $p = $this->one('SELECT p.id, p.name, s.author, s.created_at FROM people p JOIN edits e ON e.id = p.deleted_by
            JOIN saves s ON s.id = e.save_id WHERE p.id = ? AND p.tree_id = ? AND s.version > ?', [$id, $tree, $base]);
          if ($p) $conflicts[] = ['person_id' => $p['id'], 'name' => $p['name'], 'by' => $p['author'], 'at' => $p['created_at'], 'reason' => 'deleted'];
        }
        foreach (array_unique($changed) as $id) {
          if (isset($new[$id])) continue;
          $p = $this->one('SELECT p.id, p.name, s.author, s.created_at FROM people p JOIN edit_people ep ON ep.person_id = p.id
            JOIN edits e ON e.id = ep.edit_id JOIN saves s ON s.id = e.save_id
            WHERE p.id = ? AND p.tree_id = ? AND p.deleted_by IS NULL AND s.tree_id = ? AND s.version > ? ORDER BY s.id DESC LIMIT 1',
            [$id, $tree, $tree, $base]);
          if ($p) $conflicts[] = ['person_id' => $p['id'], 'name' => $p['name'], 'by' => $p['author'], 'at' => $p['created_at'], 'reason' => 'changed'];
        }
        if ($conflicts) return ['ok' => false, 'conflicts' => $conflicts];
      }
      $this->q('UPDATE trees SET version = version + 1 WHERE id = ?', [$tree]);
      $version = (int)$this->val('SELECT version FROM trees WHERE id = ?', [$tree]);
      $this->q('INSERT INTO saves (tree_id, author, version, created_at) VALUES (?, ?, ?, ?)', [$tree, $author, $version, self::now()]);
      $save = (int)$this->db->lastInsertId();
      foreach ($ops as $op) $this->applyOp($tree, $save, $author, $op);
      if ((int)$this->val('SELECT COUNT(*) FROM people WHERE tree_id = ? AND deleted_by IS NULL', [$tree]) > 10000) fail('too_large');
      return ['ok' => true, 'save_id' => $save, 'version' => $version];
    });
  }

  // Правка только из известных полей: лишнее не попадает в журнал.
  private static function cleanOp(array $p): array {
    $out = [];
    foreach (['type', 'id', 'person_id', 'parent_id', 'child_id', 'a_id', 'b_id', 'marriage_id'] as $k)
      if (isset($p[$k]) && is_scalar($p[$k])) $out[$k] = (string)$p[$k];
    foreach (['name', 'spouse'] as $k) if (array_key_exists($k, $p) && is_scalar($p[$k])) $out[$k] = mb_substr((string)$p[$k], 0, 200);
    if (isset($p['index']) && (is_int($p['index']) || is_float($p['index']))) $out['index'] = (int)$p['index'];
    return $out;
  }

  private function logEdit(int $save, array $op, ?array $before, ?array $after, array $people, ?string $type = null): int {
    $this->q('INSERT INTO edits (save_id, op_type, op, before_json, after_json) VALUES (?, ?, ?, ?, ?)', [$save, $type ?? (string)($op['type'] ?? ''),
      json_encode($op, JSON_UNESCAPED_UNICODE), $before === null ? null : json_encode($before, JSON_UNESCAPED_UNICODE),
      $after === null ? null : json_encode($after, JSON_UNESCAPED_UNICODE)]);
    $edit = (int)$this->db->lastInsertId();
    foreach (array_unique($people) as $pid) $this->q('INSERT INTO edit_people (person_id, edit_id) VALUES (?, ?)', [$pid, $edit]);
    return $edit;
  }
  private function setEdit(int $edit, ?array $before, ?array $after, array $people): void {
    $this->q('UPDATE edits SET before_json = ?, after_json = ? WHERE id = ?', [$before === null ? null : json_encode($before, JSON_UNESCAPED_UNICODE),
      $after === null ? null : json_encode($after, JSON_UNESCAPED_UNICODE), $edit]);
    foreach (array_unique($people) as $pid) $this->q('INSERT INTO edit_people (person_id, edit_id) VALUES (?, ?)', [$pid, $edit]);
  }

  private function applyOp(string $tree, int $save, string $author, array $op): void {
    $type = $op['type'] ?? null;
    if (!is_string($type)) fail('bad_op');
    $edit = $this->logEdit($save, self::cleanOp($op), null, null, []);
    $root = $this->root($tree); $now = self::now();
    $before = null; $after = null; $ids = [];
    switch ($type) {
      case 'add_child': {
        $id = self::uuidOf($op, 'id');
        if ($this->val('SELECT COUNT(*) FROM people WHERE id = ?', [$id])) fail('bad_op');
        $p = $this->alive($tree, self::uuidOf($op, 'parent_id'));
        $row = ['id' => $id, 'parent_id' => $p['id'], 'pos' => $this->nextPos($p['id']), 'name' => self::cleanName($op['name'] ?? null), 'spouse' => self::cleanSpouse($op['spouse'] ?? '')];
        $this->q('INSERT INTO people (id, tree_id, parent_id, pos, name, spouse, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [$id, $tree, $row['parent_id'], $row['pos'], $row['name'], $row['spouse'], $author, $now]);
        $after = $row; $ids = [$id];
        break;
      }
      case 'add_parent': {
        $id = self::uuidOf($op, 'id');
        if ($this->val('SELECT COUNT(*) FROM people WHERE id = ?', [$id])) fail('bad_op');
        $c = $this->alive($tree, self::uuidOf($op, 'child_id'));
        if ($c['id'] !== $root) fail('not_root');
        $row = ['id' => $id, 'parent_id' => null, 'pos' => 0, 'name' => self::cleanName($op['name'] ?? null), 'spouse' => self::cleanSpouse($op['spouse'] ?? '')];
        $this->q('INSERT INTO people (id, tree_id, parent_id, pos, name, spouse, updated_by, updated_at) VALUES (?, ?, NULL, 0, ?, ?, ?, ?)',
          [$id, $tree, $row['name'], $row['spouse'], $author, $now]);
        $this->q('UPDATE people SET parent_id = ?, pos = 0, updated_by = ?, updated_at = ? WHERE id = ?', [$id, $author, $now, $c['id']]);
        $this->q('UPDATE trees SET root_id = ? WHERE id = ?', [$id, $tree]);
        $before = ['root_id' => $root, 'child' => self::person($c)]; $after = ['root_id' => $id, 'person' => $row]; $ids = [$id, $c['id']];
        break;
      }
      case 'update': {
        $p = $this->alive($tree, self::uuidOf($op, 'person_id'));
        if (!array_key_exists('name', $op) && !array_key_exists('spouse', $op)) fail('bad_op');
        $name = array_key_exists('name', $op) ? self::cleanName($op['name']) : $p['name'];
        $spouse = array_key_exists('spouse', $op) ? self::cleanSpouse($op['spouse']) : $p['spouse'];
        $this->q('UPDATE people SET name = ?, spouse = ?, updated_by = ?, updated_at = ? WHERE id = ?', [$name, $spouse, $author, $now, $p['id']]);
        $before = self::person($p); $after = ['name' => $name, 'spouse' => $spouse] + $before; $ids = [$p['id']];
        break;
      }
      case 'move': {
        $p = $this->alive($tree, self::uuidOf($op, 'person_id'));
        if ($p['id'] === $root) fail('root_protected');
        $np = $this->alive($tree, self::uuidOf($op, 'parent_id'));
        if (in_array($np['id'], $this->branch($p['id'], false), true)) fail('cycle');
        $pos = $this->nextPos($np['id']);
        $this->q('UPDATE people SET parent_id = ?, pos = ?, updated_by = ?, updated_at = ? WHERE id = ?', [$np['id'], $pos, $author, $now, $p['id']]);
        $before = self::person($p); $after = ['parent_id' => $np['id'], 'pos' => $pos] + $before; $ids = [$p['id']];
        break;
      }
      case 'delete': {
        $p = $this->alive($tree, self::uuidOf($op, 'person_id'));
        if ($p['id'] === $root) fail('root_protected');
        $ids = $this->branch($p['id'], true);
        $in = implode(',', array_fill(0, count($ids), '?'));
        $this->q("UPDATE people SET deleted_by = ?, updated_by = ?, updated_at = ? WHERE id IN ($in)", [$edit, $author, $now, ...$ids]);
        $before = ['name' => $p['name']]; $after = ['count' => count($ids)];
        break;
      }
      case 'reorder': {
        // Сдвинуть среди братьев и сестёр: порядок = старшинство.
        $p = $this->alive($tree, self::uuidOf($op, 'person_id'));
        if ($p['id'] === $root) fail('root_protected');
        if (!isset($op['index']) || !(is_int($op['index']) || is_float($op['index']))) fail('bad_op');
        $sib = $this->q('SELECT id, pos FROM people WHERE parent_id = ? AND deleted_by IS NULL ORDER BY pos, id', [$p['parent_id']])->fetchAll();
        $before = array_map(fn($s) => ['id' => $s['id'], 'pos' => (int)$s['pos']], $sib);
        $order = array_values(array_filter(array_column($sib, 'id'), fn($id) => $id !== $p['id']));
        $k = max(0, min((int)$op['index'], count($order)));
        array_splice($order, $k, 0, [$p['id']]);
        foreach ($order as $i => $id) $this->q('UPDATE people SET pos = ? WHERE id = ?', [$i, $id]);
        $this->q('UPDATE people SET updated_by = ?, updated_at = ? WHERE id = ?', [$author, $now, $p['id']]);
        $after = ['name' => $p['name'], 'index' => $k, 'count' => count($sib),
          'parent' => $this->val('SELECT name FROM people WHERE id = ?', [$p['parent_id']])];
        $ids = [$p['id']];
        break;
      }
      case 'marry': {
        $id = self::uuidOf($op, 'id');
        if ($this->val('SELECT COUNT(*) FROM marriages WHERE id = ?', [$id])) fail('bad_op');
        $a = $this->alive($tree, self::uuidOf($op, 'a_id')); $b = $this->alive($tree, self::uuidOf($op, 'b_id'));
        if ($a['id'] === $b['id'] || $this->val('SELECT COUNT(*) FROM marriages WHERE tree_id = ? AND deleted_by IS NULL
             AND ((a_id = ? AND b_id = ?) OR (a_id = ? AND b_id = ?))', [$tree, $a['id'], $b['id'], $b['id'], $a['id']])) fail('bad_op');
        $this->q('INSERT INTO marriages (id, tree_id, a_id, b_id) VALUES (?, ?, ?, ?)', [$id, $tree, $a['id'], $b['id']]);
        $after = ['id' => $id, 'a_id' => $a['id'], 'b_id' => $b['id'], 'a' => $a['name'], 'b' => $b['name']]; $ids = [$a['id'], $b['id']];
        break;
      }
      case 'unmarry': {
        $m = $this->one('SELECT * FROM marriages WHERE id = ? AND tree_id = ? AND deleted_by IS NULL', [self::uuidOf($op, 'marriage_id'), $tree]);
        if (!$m) fail('bad_op');
        $this->q('UPDATE marriages SET deleted_by = ? WHERE id = ?', [$edit, $m['id']]);
        $before = ['id' => $m['id'], 'a_id' => $m['a_id'], 'b_id' => $m['b_id'],
          'a' => $this->val('SELECT name FROM people WHERE id = ?', [$m['a_id']]), 'b' => $this->val('SELECT name FROM people WHERE id = ?', [$m['b_id']])];
        $ids = [$m['a_id'], $m['b_id']];
        break;
      }
      default: fail('bad_op');
    }
    $this->setEdit($edit, $before, $after, $ids);
  }

  // ── история и откат ──────────────────────────────────────────────────

  private static function dec(?string $j): mixed { return $j === null ? null : json_decode($j, true); }
  private function editPeople(int $edit): array {
    return $this->q('SELECT person_id FROM edit_people WHERE edit_id = ?', [$edit])->fetchAll(PDO::FETCH_COLUMN);
  }

  public function revert(mixed $token, mixed $author, mixed $saveId, mixed $editId = null): array {
    $r = $this->role(is_string($token) ? $token : null);
    if ($r['role'] !== 'owner') fail('forbidden');
    $author = self::cleanName($author);
    $tree = $r['tree_id']; $saveId = (int)$saveId; $editId = $editId === null ? null : (int)$editId;
    return $this->tx($tree, function () use ($tree, $author, $saveId, $editId) {
      $orig = $this->one('SELECT * FROM saves WHERE id = ? AND tree_id = ?', [$saveId, $tree]);
      if (!$orig || $orig['reverts_save'] !== null) fail('bad_op');
      if ($editId !== null && !$this->val('SELECT COUNT(*) FROM edits WHERE id = ? AND save_id = ?', [$editId, $saveId])) fail('bad_op');
      $edits = $this->q('SELECT * FROM edits WHERE save_id = ? AND reverted_by IS NULL' . ($editId !== null ? ' AND id = ?' : '') . ' ORDER BY id DESC',
        $editId !== null ? [$saveId, $editId] : [$saveId])->fetchAll();
      // Предупреждения: кто менял тех же людей после этого сохранения.
      $warn = [];
      foreach ($edits as $e) foreach ($this->editPeople((int)$e['id']) as $pid) {
        if (isset($warn[$pid])) continue;
        $w = $this->one('SELECT p.id, p.name, s.author, s.created_at FROM people p JOIN edit_people ep ON ep.person_id = p.id
          JOIN edits x ON x.id = ep.edit_id JOIN saves s ON s.id = x.save_id WHERE p.id = ? AND s.tree_id = ? AND s.id > ? ORDER BY s.id DESC LIMIT 1',
          [$pid, $tree, $saveId]);
        if ($w) $warn[$pid] = ['person_id' => $w['id'], 'name' => $w['name'], 'by' => $w['author'], 'at' => $w['created_at']];
      }
      $this->q('UPDATE trees SET version = version + 1 WHERE id = ?', [$tree]);
      $version = (int)$this->val('SELECT version FROM trees WHERE id = ?', [$tree]);
      $this->q('INSERT INTO saves (tree_id, author, version, created_at, reverts_save, reverts_edit) VALUES (?, ?, ?, ?, ?, ?)',
        [$tree, $author, $version, self::now(), $saveId, $editId]);
      $save = (int)$this->db->lastInsertId();
      foreach ($edits as $e) $this->undoEdit($tree, $save, $author, $e);
      if (!$edits) fail('already_reverted');
      return ['ok' => true, 'save_id' => $save, 'version' => $version, 'warnings' => array_values($warn)];
    });
  }

  private function undoEdit(string $tree, int $save, string $author, array $e): void {
    $type = $e['op_type']; $op = self::dec($e['op']); $b = self::dec($e['before_json']); $a = self::dec($e['after_json']);
    $people = $this->editPeople((int)$e['id']);
    $edit = $this->logEdit($save, ['type' => 'revert', 'of' => (int)$e['id'], 'kind' => $type], null, null, $people, 'revert');
    $now = self::now();
    switch ($type) {
      case 'add_child': {
        if (!$this->val('SELECT COUNT(*) FROM people WHERE id = ? AND deleted_by IS NULL', [$a['id']])) break;
        $ids = $this->branch($a['id'], true);
        $in = implode(',', array_fill(0, count($ids), '?'));
        $this->q("UPDATE people SET deleted_by = ?, updated_by = ?, updated_at = ? WHERE id IN ($in)", [$edit, $author, $now, ...$ids]);
        break;
      }
      case 'add_parent': {
        // Откат возможен, только пока добавленный предок — корень и у него один ребёнок: прежний корень.
        $id = $a['person']['id']; $old = $b['child'];
        if ($this->root($tree) !== $id
            || !$this->val('SELECT COUNT(*) FROM people WHERE id = ? AND deleted_by IS NULL', [$id])
            || !$this->val('SELECT COUNT(*) FROM people WHERE id = ? AND deleted_by IS NULL AND parent_id = ?', [$old['id'], $id])
            || (int)$this->val('SELECT COUNT(*) FROM people WHERE parent_id = ? AND deleted_by IS NULL', [$id]) !== 1) fail('cannot_revert');
        $this->q('UPDATE people SET parent_id = NULL, pos = ?, updated_by = ?, updated_at = ? WHERE id = ?', [$old['pos'], $author, $now, $old['id']]);
        $this->q('UPDATE trees SET root_id = ? WHERE id = ?', [$b['root_id'], $tree]);
        $this->q('UPDATE people SET deleted_by = ?, updated_by = ?, updated_at = ? WHERE id = ? AND deleted_by IS NULL', [$edit, $author, $now, $id]);
        break;
      }
      case 'update': {
        $cur = $this->one('SELECT name, spouse FROM people WHERE id = ?', [$b['id']]);
        $this->q('UPDATE people SET name = ?, spouse = ?, updated_by = ?, updated_at = ? WHERE id = ?', [
          array_key_exists('name', $op) ? $b['name'] : $cur['name'], array_key_exists('spouse', $op) ? $b['spouse'] : $cur['spouse'], $author, $now, $b['id']]);
        break;
      }
      case 'move': {
        $pid = $b['parent_id'];
        if (!$pid || !$this->val('SELECT COUNT(*) FROM people WHERE id = ? AND deleted_by IS NULL', [$pid])) fail('cannot_revert');
        // Прежний родитель мог оказаться внутри ветки переносимого — откат замкнул бы цикл.
        if (in_array($pid, $this->branch($b['id'], false), true)) fail('cannot_revert');
        $this->q('UPDATE people SET parent_id = ?, pos = ?, updated_by = ?, updated_at = ? WHERE id = ?', [$pid, $b['pos'], $author, $now, $b['id']]);
        break;
      }
      case 'delete': {
        // Вернуть ветку можно, только если её родитель жив.
        $x = $this->one('SELECT parent_id FROM people WHERE id = ?', [$op['person_id']]);
        if ($x && $x['parent_id'] !== null && !$this->val('SELECT COUNT(*) FROM people WHERE id = ? AND deleted_by IS NULL', [$x['parent_id']])) fail('cannot_revert');
        $this->q('UPDATE people SET deleted_by = NULL, updated_by = ?, updated_at = ? WHERE deleted_by = ?', [$author, $now, (int)$e['id']]);
        break;
      }
      case 'reorder':
        foreach ($b as $s) $this->q('UPDATE people SET pos = ? WHERE id = ?', [$s['pos'], $s['id']]);
        break;
      case 'marry':
        $this->q('UPDATE marriages SET deleted_by = ? WHERE id = ? AND deleted_by IS NULL', [$edit, $a['id']]);
        break;
      case 'unmarry':
        $this->q('UPDATE marriages SET deleted_by = NULL WHERE id = ?', [$b['id']]);
        break;
      default: fail('bad_op');
    }
    $this->q('UPDATE edits SET reverted_by = ? WHERE id = ?', [$save, (int)$e['id']]);
  }

  public function get_history(mixed $token, mixed $limit = 50, mixed $before = null): array {
    $r = $this->role(is_string($token) ? $token : null);
    if (!in_array($r['role'], ['owner', 'edit'], true)) fail('forbidden');
    $limit = max(1, min((int)($limit ?? 50), 200));
    $saves = $this->q('SELECT * FROM saves WHERE tree_id = ?' . ($before !== null ? ' AND id < ?' : '') . " ORDER BY id DESC LIMIT $limit",
      $before !== null ? [$r['tree_id'], (int)$before] : [$r['tree_id']])->fetchAll();
    $out = [];
    foreach ($saves as $s) {
      $edits = array_map(fn($e) => ['edit_id' => (int)$e['id'], 'op' => self::dec($e['op']), 'before' => self::dec($e['before_json']),
        'after' => self::dec($e['after_json']), 'reverted_by' => $e['reverted_by'] === null ? null : (int)$e['reverted_by'],
        'people' => $this->editPeople((int)$e['id'])], $this->q('SELECT * FROM edits WHERE save_id = ? ORDER BY id', [$s['id']])->fetchAll());
      $rev = array_column($edits, 'reverted_by');
      $out[] = ['save_id' => (int)$s['id'], 'author' => $s['author'], 'at' => $s['created_at'],
        'reverts_save' => $s['reverts_save'] === null ? null : (int)$s['reverts_save'],
        'reverts_edit' => $s['reverts_edit'] === null ? null : (int)$s['reverts_edit'],
        'reverted_by' => $edits && !in_array(null, $rev, true) ? max($rev) : null, 'edits' => $edits];
    }
    return $out;
  }

  public function deleted_items(mixed $token): array {
    $r = $this->role(is_string($token) ? $token : null);
    if ($r['role'] !== 'owner') fail('forbidden');
    $rows = $this->q("SELECT e.*, s.author, s.created_at FROM edits e JOIN saves s ON s.id = e.save_id
      WHERE s.tree_id = ? AND e.op_type = 'delete' AND e.reverted_by IS NULL ORDER BY e.id DESC", [$r['tree_id']])->fetchAll();
    return array_map(function ($e) {
      $op = self::dec($e['op']); $b = self::dec($e['before_json']); $a = self::dec($e['after_json']);
      return ['edit_id' => (int)$e['id'], 'save_id' => (int)$e['save_id'], 'person_id' => $op['person_id'] ?? null,
        'name' => $b['name'] ?? '', 'count' => (int)($a['count'] ?? 0), 'by' => $e['author'], 'at' => $e['created_at']];
    }, $rows);
  }

  // Удаление древа целиком — только по ссылке создателя и с точным названием в подтверждение. Отменить нельзя.
  public function delete_tree(mixed $token, mixed $title): bool {
    $r = $this->role(is_string($token) ? $token : null);
    if ($r['role'] !== 'owner') fail('forbidden');
    $tree = $r['tree_id'];
    return $this->tx($tree, function () use ($tree, $title) {
      $t = $this->one('SELECT title FROM trees WHERE id = ?', [$tree]);
      if (!$t || !is_string($title) || trim($title) !== trim($t['title'])) fail('wrong_title');
      $this->q('DELETE FROM edit_people WHERE edit_id IN (SELECT e.id FROM edits e JOIN saves s ON s.id = e.save_id WHERE s.tree_id = ?)', [$tree]);
      $this->q('DELETE FROM edits WHERE save_id IN (SELECT id FROM saves WHERE tree_id = ?)', [$tree]);
      foreach (['saves', 'marriages', 'people', 'tree_tokens'] as $table) $this->q("DELETE FROM $table WHERE tree_id = ?", [$tree]);
      $this->q('DELETE FROM trees WHERE id = ?', [$tree]);
      return true;
    });
  }
}
