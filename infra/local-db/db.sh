#!/usr/bin/env bash
# Local test database: Postgres + the open-source Supabase components the current app needs,
# all in Docker on this machine. Never linked to a Supabase cloud project.
# Usage: bash infra/local-db/db.sh up | down | reset | status
set -euo pipefail
cd "$(dirname "$0")"
CLI="npx --yes supabase@2.120.0"
case "${1:-status}" in
  up)     $CLI start ;;
  down)   $CLI stop ;;
  reset)  $CLI db reset --local ;;
  status) $CLI status ;;
  *)      echo "usage: db.sh up|down|reset|status"; exit 2 ;;
esac
