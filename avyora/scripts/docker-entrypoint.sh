#!/bin/sh
set -eu

PORTAL="${AVYORA_APP:-store}"
echo "[avyora] starting portal=${PORTAL}"

if [ -n "${DATABASE_URL:-}" ] && [ "${WAIT_FOR_DB:-true}" = "true" ]; then
  HOST="${POSTGRES_HOST:-db}"
  USER="${POSTGRES_USER:-avyora}"
  DBNAME="${POSTGRES_DB:-avyora}"
  echo "[avyora] waiting for postgres at ${HOST}..."
  i=0
  until pg_isready -h "$HOST" -U "$USER" -d "$DBNAME" >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -gt 60 ]; then
      echo "[avyora] database not ready after 60s" >&2
      exit 1
    fi
    sleep 1
  done
fi

exec node server.js
