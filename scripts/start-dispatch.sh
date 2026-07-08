#!/usr/bin/env sh
# Railway start-command dispatcher. Root railway.toml runs this via `sh scripts/start-dispatch.sh`.
#
# One repo backs multiple Railway services (one web + N cron) by branching on $SERVICE_ROLE.
# We use this instead of Railway per-service config files because config-as-code kept either
# overriding the wrong way or not applying at all (see docs/LESSONS_LEARNED.md "Railway cron").
#
# CRITICAL SAFETY: when SERVICE_ROLE is unset/empty/"web" this MUST reproduce the EXACT command
# the web service has always run in production:
#     npm run db:migrate && npm run seed:users && npm start
# ...byte for byte. Do not change the web path — production depends on it.
#
# Cron services set SERVICE_ROLE via a Railway env var (realnex | box-incremental | box-full)
# plus their own cronSchedule (a per-service dashboard field, which does register). Each cron
# runs scripts/sync-cron.ts, which awaits the job to completion then process.exit()s, so Railway
# records success/failure per run.

case "${SERVICE_ROLE:-web}" in
  web)
    npm run db:migrate && npm run seed:users && npm start
    ;;
  realnex)
    npm run sync:realnex
    ;;
  box-incremental)
    npm run sync:box:incremental
    ;;
  box-full)
    npm run sync:box:full
    ;;
  *)
    echo "[start-dispatch] FATAL: unknown SERVICE_ROLE='${SERVICE_ROLE}' (expected web|realnex|box-incremental|box-full)" >&2
    exit 1
    ;;
esac
