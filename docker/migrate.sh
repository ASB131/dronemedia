#!/bin/sh
set -e

echo "[migrate] Waiting for PostgreSQL..."
until pg_isready -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" >/dev/null 2>&1; do
  sleep 1
done

echo "[migrate] Running database migrations..."
npm run db:migrate

echo "[migrate] Backfilling playback flags from cache…"
npx tsx scripts/backfill-playback-flags.ts || echo "[migrate] Playback flag backfill skipped/failed (non-fatal)"

echo "[migrate] Complete"
