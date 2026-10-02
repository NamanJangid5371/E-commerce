#!/bin/sh
# Postgres + commerce data backup (runs in Alpine postgres image or any host with pg_dump).
set -eu

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
HOST="${POSTGRES_HOST:-localhost}"
USER="${POSTGRES_USER:-avyora}"
DBNAME="${POSTGRES_DB:-avyora}"
PASSWORD="${POSTGRES_PASSWORD:-}"
DATA_DIR="${DATA_DIR:-/data}"

mkdir -p "$BACKUP_DIR"
STAGING="$BACKUP_DIR/avyora-$TIMESTAMP"
mkdir -p "$STAGING"

echo "[backup] writing $STAGING"

if [ -n "$PASSWORD" ]; then
  export PGPASSWORD="$PASSWORD"
fi

pg_dump -h "$HOST" -U "$USER" -d "$DBNAME" --format=custom --file="$STAGING/postgres.dump"

if [ -d "$DATA_DIR" ]; then
  mkdir -p "$STAGING/data"
  if [ -f "$DATA_DIR/commerce.json" ]; then
    cp "$DATA_DIR/commerce.json" "$STAGING/data/commerce.json"
  fi
  if [ -f "$DATA_DIR/smtp.json" ]; then
    cp "$DATA_DIR/smtp.json" "$STAGING/data/smtp.json"
  fi
fi

tar -C "$BACKUP_DIR" -czf "$BACKUP_DIR/avyora-$TIMESTAMP.tar.gz" "avyora-$TIMESTAMP"
rm -rf "$STAGING"

# prune old archives
find "$BACKUP_DIR" -name 'avyora-*.tar.gz' -type f -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true

echo "[backup] done → $BACKUP_DIR/avyora-$TIMESTAMP.tar.gz"
