<?php
// Перенос данных из выгрузки Supabase (JSON) в базу сайта. Ключи ссылок, люди, браки и вся история — как были.
//   php scripts/import-supabase.php <export.json> <dsn> [user] [pass]
// На хостинге запускается один раз через scripts/import-runner.php и удаляется.
declare(strict_types=1);

function drevo_import(PDO $db, array $d): array {
  $ts = function (?string $t): ?string {
    if ($t === null) return null;
    $dt = new DateTimeImmutable($t);
    return $dt->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z');
  };
  $mysql = $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
  $mysql ? $db->beginTransaction() : $db->exec('BEGIN IMMEDIATE');
  $ins = function (string $table, array $row) use ($db) {
    $cols = array_keys($row);
    $st = $db->prepare("INSERT INTO $table (" . implode(', ', $cols) . ') VALUES (' . implode(', ', array_fill(0, count($cols), '?')) . ')');
    $st->execute(array_values($row));
  };
  if ((int)$db->query('SELECT COUNT(*) FROM trees')->fetchColumn() > 0) throw new RuntimeException('база не пустая — перенос уже был');
  foreach ($d['trees'] as $t) $ins('trees', ['id' => $t['id'], 'title' => $t['title'], 'root_id' => $t['root_id'], 'version' => $t['version'],
    'is_example' => $t['is_example'] ? 1 : 0, 'created_at' => $ts($t['created_at'])]);
  foreach ($d['tree_tokens'] as $t) $ins('tree_tokens', ['hash' => $t['hash'], 'tree_id' => $t['tree_id'], 'role' => $t['role']]);
  foreach ($d['people'] as $p) $ins('people', ['id' => $p['id'], 'tree_id' => $p['tree_id'], 'parent_id' => $p['parent_id'], 'pos' => $p['pos'],
    'name' => $p['name'], 'spouse' => $p['spouse'], 'deleted_by' => $p['deleted_by'], 'updated_by' => $p['updated_by'], 'updated_at' => $ts($p['updated_at'])]);
  foreach ($d['marriages'] as $m) $ins('marriages', ['id' => $m['id'], 'tree_id' => $m['tree_id'], 'a_id' => $m['a_id'], 'b_id' => $m['b_id'], 'deleted_by' => $m['deleted_by']]);
  foreach ($d['saves'] as $s) $ins('saves', ['id' => $s['id'], 'tree_id' => $s['tree_id'], 'author' => $s['author'], 'version' => $s['version'],
    'created_at' => $ts($s['created_at']), 'reverts_save' => $s['reverts_save'], 'reverts_edit' => $s['reverts_edit']]);
  foreach ($d['edits'] as $e) {
    $j = fn($v) => $v === null ? null : json_encode($v, JSON_UNESCAPED_UNICODE);
    $ins('edits', ['id' => $e['id'], 'save_id' => $e['save_id'], 'op_type' => (string)($e['op']['type'] ?? ''), 'op' => $j($e['op']),
      'before_json' => $j($e['before']), 'after_json' => $j($e['after']), 'reverted_by' => $e['reverted_by']]);
    foreach (array_unique($e['people'] ?? []) as $pid) $ins('edit_people', ['person_id' => $pid, 'edit_id' => $e['id']]);
  }
  $mysql ? $db->commit() : $db->exec('COMMIT');
  // Счётчики автонумерации — дальше последних перенесённых id. ALTER TABLE в MySQL сам завершает транзакцию, поэтому после commit.
  if ($mysql) foreach (['saves', 'edits'] as $t) {
    $next = (int)$db->query("SELECT COALESCE(MAX(id), 0) + 1 FROM $t")->fetchColumn();
    $db->exec("ALTER TABLE $t AUTO_INCREMENT = $next");
  }
  $count = fn($t) => (int)$db->query("SELECT COUNT(*) FROM $t")->fetchColumn();
  return ['trees' => $count('trees'), 'tree_tokens' => $count('tree_tokens'), 'people' => $count('people'),
    'marriages' => $count('marriages'), 'saves' => $count('saves'), 'edits' => $count('edits')];
}

if (PHP_SAPI === 'cli' && realpath($argv[0]) === realpath(__FILE__)) {
  [, $file, $dsn] = $argv;
  $db = new PDO($dsn, $argv[3] ?? null, $argv[4] ?? null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
  $mysql = $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
  $db->exec(file_get_contents(__DIR__ . '/../api/' . ($mysql ? 'schema.mysql.sql' : 'schema.sqlite.sql')));
  echo json_encode(drevo_import($db, json_decode(file_get_contents($file), true)), JSON_UNESCAPED_UNICODE), "\n";
}
