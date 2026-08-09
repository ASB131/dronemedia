#!/bin/sh
set -e

fix_storage_permissions() {
  for dir in "$APP_DATA_PATH" "$CACHE_PATH" "$MEDIA_PATH"; do
    [ -n "$dir" ] || continue
    # Never touch a Postgres data dir if someone mis-points CACHE_PATH
    if [ -f "$dir/PG_VERSION" ] || [ -d "$dir/postgres" ]; then
      echo "[entrypoint] Refusing to chown $dir (looks like Postgres data)"
      continue
    fi
    mkdir -p "$dir"
    chown -R nextjs:nodejs "$dir" 2>/dev/null || chmod -R a+rwX "$dir" 2>/dev/null || true
  done
}

run_migrations() {
  if [ "$RUN_MIGRATIONS" = "true" ]; then
    sh ./docker/migrate.sh
  fi
}

if [ "$(id -u)" = "0" ] && id nextjs >/dev/null 2>&1; then
  fix_storage_permissions
  run_migrations
  exec gosu nextjs "$@"
fi

run_migrations
exec "$@"
