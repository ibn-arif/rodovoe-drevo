<?php
// Роутер для php -S в тестах: API — через api/index.php, служебные файлы не отдаём, остальное — как есть.
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path === '/api/index.php' || $path === '/api/') { require __DIR__ . '/../../api/index.php'; return true; }
if (str_starts_with($path, '/api/') || str_starts_with($path, '/private/') || str_starts_with($path, '/tests/')) { http_response_code(404); return true; }
return false;
