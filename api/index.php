<?php
// API родового древа: POST {"fn": "...", "args": [...]} → {"data": ...} или HTTP 400 {"error": "код"}.
// Права проверяет сервер по токену из ссылки; таблицы напрямую недоступны.
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function reply(int $status, array $body): void {
  http_response_code($status);
  echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { reply(405, ['error' => 'bad_request']); return; }
$raw = file_get_contents('php://input', false, null, 0, 2_000_001);
if ($raw === false || strlen($raw) > 2_000_000) { reply(400, ['error' => 'too_large']); return; }
$req = json_decode($raw, true);
if (!is_array($req) || !is_string($req['fn'] ?? null) || !is_array($req['args'] ?? [])) { reply(400, ['error' => 'bad_request']); return; }

require __DIR__ . '/lib.php';

try {
  $api = new Drevo(drevo_connect(), drevo_client_ip());
  reply(200, ['data' => $api->call($req['fn'], array_values($req['args'] ?? []))]);
} catch (ApiError $e) {
  reply(400, ['error' => $e->getMessage()]);
} catch (TypeError | ArgumentCountError | ValueError $e) {
  reply(400, ['error' => 'bad_request']);
} catch (Throwable $e) {
  error_log('drevo: ' . $e);
  reply(500, ['error' => 'network']);
}
