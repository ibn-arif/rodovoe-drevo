#!/bin/bash
# Выкладка сайта на хостинг по FTP (с TLS). Доступы — в private/ftp.txt и private/db.txt (не в git).
#   scripts/deploy.sh          — файлы сайта и API
#   scripts/deploy.sh config   — ещё и файл доступа к базе (вне корня сайта)
set -euo pipefail
cd "$(dirname "$0")/.."
FTP_USER=$(sed -n 2p private/ftp.txt); FTP_PASS=$(sed -n 3p private/ftp.txt)
HOST=ru6.link-host.net
SITE=www/pamyat-roda.ru
STAGE=$(mktemp -d); SECRET=$(mktemp -d)
trap 'rm -rf "$STAGE" "$SECRET"' EXIT
cp index.html tree.html .htaccess "$STAGE"/
cp -R css js vendor api "$STAGE"/
CMDS="set net:timeout 30; set net:max-retries 2; mirror -R --verbose=1 --no-perms --exclude-glob .DS_Store $STAGE $SITE;"
if [ "${1:-}" = config ]; then
  DB_HOST=$(sed -n 1p private/db.txt); DB_NAME=$(sed -n 2p private/db.txt); DB_USER=$(sed -n 3p private/db.txt); DB_PASS=$(sed -n 4p private/db.txt)
  php -r 'echo "<?php\n// Доступ к базе родового древа. Лежит вне корня сайта, в git не попадает.\nreturn " . var_export(["dsn" => "mysql:host=$argv[1];dbname=$argv[2];charset=utf8mb4", "user" => $argv[3], "pass" => $argv[4]], true) . ";\n";' \
    "$DB_HOST" "$DB_NAME" "$DB_USER" "$DB_PASS" > "$SECRET/pamyat-roda.config.php"
  CMDS="$CMDS put -O www $SECRET/pamyat-roda.config.php; chmod 600 www/pamyat-roda.config.php;"
fi
lftp -u "$FTP_USER,$FTP_PASS" -e "$CMDS bye" "$HOST"
echo "Готово: https://pamyat-roda.ru/"
