# Hoeck Team Dashboard — MEMORY

## Project Overview
Tenant rep dashboard for Mike Hoeck, Jack Chapman, Nadya Gorelov. Plus Reed LaBar as builder/admin.
Stack: Next.js 16 + TypeScript, Postgres on Railway (managed), Drizzle ORM, Tailwind + shadcn/ui, React Query.
RealNex (read + create only), Box (read + folder-create + file-upload + scoped rename).
Master Excel: append-only in v1.

## Critical Safety Rules (NEVER VIOLATE)
- NEVER add update/delete methods to `lib/external/realnex/safe.ts`
- NEVER add delete/move methods to `lib/external/box/safe.ts`
- ONLY rename allowed is `renameDealFolder` with `DEAL_FOLDER_PATTERN` check
- NEVER allow `renameFile` under any circumstance
- Master Excel: append-only, never overwrite existing rows
- All Box file writes upload as NEW VERSION
- All dashboard tables: soft delete only (`deleted_at`)
- All updates: optimistic locking (`version` column, auto-incremented by trigger)
- Forbidden methods are absent from safe wrappers AND covered by unit tests
- Seed scripts are idempotent — use `ON CONFLICT (...) DO NOTHING`, never UPDATE/DELETE existing rows (see inbound-tracker commit `0fdcb2f` — destructive seeding wiped live DB on every redeploy)

## Lessons Learned (do not re-violate)
- SQLite on synced folders corrupts under concurrent edits → Postgres on Railway (managed)
- Hardcoded DB paths break silently → `DATABASE_URL` env var only, no fallback
- Tab data goes stale without React Query → use refetch-on-focus + polling
- Background jobs need UI invalidation → `system_state` polling
- Git reverts wipe work → session start ritual checks `git log`
- Users feared losing data → `/api/export/all` backup endpoint + (Phase 2) weekly `pg_dump` to Box
- No "is this fresh?" indicator → `<LastUpdated />` on every view
- Hobby Railway plan has NO Postgres backups → we own the backup story (manual export now, weekly cron in Phase 2)
- Seed scripts can silently wipe live data (inbound-tracker `0fdcb2f`) → seeds are idempotent
- Next.js on Railway with volumes needs `output: 'standalone'` (inbound-tracker `ec15a33`) → set from day 1
- 8h auth TTL too short for workday (golf-bd `1ca7202`) → iron-session `maxAge: 604800` (7 days)
- 401 in components leaves users confused → global fetch wrapper reloads page on 401

## Current Status
- [x] Phase 1: Foundation + health check (build green, awaiting Railway deploy for end-to-end verification)
- [ ] Phase 2: Box folder index
- [ ] Phase 3: RealNex sync + 4 workflows
- [ ] Phase 4: Master Excel reads
- [ ] Phase 5: Master Excel appends
- [ ] Phase 6: Box folder rename
- [ ] Phase 7: Notes/tags/locking
- [ ] Phase 8: Home + backup + health UI

## Schema
(Phase 1 tables — see `lib/db/schema/`)
- `users` (id, email, name, password_hash, role, created_at, updated_at, version, deleted_at)
- `activity_feed` (id, actor_user_id, action, entity_type, entity_id, payload jsonb, status, created_at)
- `system_state` (key PK, value jsonb, updated_at)

## API Keys / Env Vars (see .env.local.example)
- DATABASE_URL (Railway public Postgres URL for local dev; Railway injects internal URL in production)
- REALNEX_API_KEY, REALNEX_API_BASE_URL
- BOX_CLIENT_ID, BOX_CLIENT_SECRET, BOX_ACCESS_TOKEN, BOX_REFRESH_TOKEN
- BOX_TENANTS_CHAPMANHOECK_FOLDER_ID
- BOX_MASTER_EXCEL_FILE_ID
- ANTHROPIC_API_KEY
- SESSION_PASSWORD (48-char random, used by iron-session)
- NODE_ENV

## Recent Changes
- 2026-05-20: Initial repo scaffold (BUILD_SPEC v3, docs, .gitignore).
- 2026-05-20: Phase 1 build — Next.js 16.2.6 + TS + Tailwind scaffolded; deps installed (drizzle, pg, react-query, iron-session, bcrypt, archiver, dotenv, drizzle-kit, tsx, husky, vitest).
- 2026-05-20: Husky pre-commit hook installed with forbidden-method grep + safe-wrapper test runner.
- 2026-05-20: Railway project `hoeck-team-dashboard` created (id `07664849-ca0a-485a-a579-0ceff99ce6d6`); Postgres service added with 5 GB volume.
- 2026-05-20: Drizzle schemas + first migration generated (`drizzle/0000_young_exiles.sql`); triggers.sql wired into `lib/db/migrate.ts`. Migration deferred to Railway deploy startCommand because CBRE corp firewall blocks the public TCP proxy port 51241.
- 2026-05-20: Auth wired (iron-session 7-day cookies, login route, idempotent seed-users.ts with `ON CONFLICT DO NOTHING` per inbound-tracker 0fdcb2f). Edge proxy (Next 16 renamed from middleware) enforces auth + 401 JSON for `/api/*` so the global fetch wrapper can reload.
- 2026-05-20: React Query providers + global 401-reload fetch wrapper (golf-bd 1ca7202) + `useSystemStateInvalidation` polling (golf-bd 9b4cf2b) + `<LastUpdated />` + `<UpdatesAvailableBadge />`.
- 2026-05-20: `/api/health` + `/health` page + `scripts/health-check.ts` CLI. 8 checks (env vars, postgres, realnex, box, box root folder, master excel, anthropic, python bridge). Postgres check is firewall-aware: warn (not fail) when unreachable from a dev host.
- 2026-05-20: `/api/export/all` + `<BackupButton />` ship the manual ZIP safety net (Phase 1's ONLY backup mechanism until Phase 2 wires the weekly pg_dump → Box cron). `scripts/backup-db.ts` stub with TODO. `scripts/backup-export.ts` CLI mirror of the endpoint.
- 2026-05-20: Dashboard shell (sidebar + header + Backup button + auth-aware user info). Home page placeholder; Phase 8 fills in widgets.
- 2026-05-20: `railway.toml`, `nixpacks.toml` (with `postgresql_16` for pg_dump), `requirements.txt`, `.env.local.example`, `next.config.ts` (output: 'standalone' per inbound-tracker ec15a33).
- 2026-05-20: Build green — `npx tsc --noEmit` zero errors, `vitest run` 34/34 pass, `npx next build` clean (9 routes resolved). Ready to commit + push + deploy.

## Known Issues / Next Up
- **Backup story is incomplete.** Railway Hobby plan has zero Postgres backups. Phase 1 ships `/api/export/all` (manual ZIP) as the only safety net. `scripts/backup-db.ts` is stubbed (pg_dump → local) with `TODO: upload to Box` — full weekly cron to be wired end of Phase 2 once Box OAuth is live. Cron entry in `railway.toml` is commented out until then.
- **DB credentials exposed in earlier shell output.** Railway-generated Postgres password leaked into Claude Code transcript during initial `railway variables` call. Acceptable risk for Phase 1 (empty dev DB), rotate before Phase 7 when real notes/tags data lands.
- **shadcn/ui not yet initialized.** Deferred to start of Phase 2 (will run `npx shadcn@latest init` then).
- **Migrations run only on Railway deploy.** CBRE corp firewall blocks outbound TCP to `kodama.proxy.rlwy.net:51241` so `npm run db:migrate` can't run from the dev laptop. `railway.toml`'s `startCommand` is `npm run db:migrate && npm run seed:users && npm start` so it runs every deploy from inside Railway's private network. `/api/health` warns (yellow) instead of fails when Postgres is unreachable from a dev host.
- **Local dev DB option not yet set up.** If laptop-side UI iteration with live data becomes necessary (probably never in Phase 1, possibly in Phase 2+), spin up Docker Postgres locally and set `DATABASE_URL` to `postgres://localhost:5432/...`. Defer this decision until it actually hurts.
- **Phase 1 verification happens on the deployed URL, not localhost.** End-to-end smoke (login flow, `/health`, BackupButton) tested via HTTPS against `https://hoeck-team-dashboard.up.railway.app` after deploy.

## Next Up
1. Finish Phase 1 (Steps 10–23): Drizzle schemas + first migration; auth; React Query providers; LastUpdated component; health check; export endpoint; dashboard shell; smoke test; commit + push.
2. Phase 2 kickoff: Box safe wrapper (read methods), folder walker, `box_folder_index` table, `/files` page, AND wire the `backup:weekly` cron to upload to a dedicated Box backup folder.

## Key Decisions
- Postgres (managed Railway), not SQLite — directly motivated by golf-bd SQLite-on-volume backup machinery (commit `156aa51`)
- React Query with 30s staleTime, refetch-on-focus
- No Master Excel cache (live reads, infrequent)
- Append-only Master Excel v1
- Activity feed = UI surface; RealNex + Box are real history
- Password auth (no SSO); iron-session 7-day cookies
- Python bridge for openpyxl (Phase 4)
- Folder rename only for adding address to deal folders (`renameDealFolder`, scoped)
- Conversational parser via Anthropic API (Workflow 3, Phase 3)
- `/api/export/all` = peace of mind, not primary rollback
- Backup strategy: manual export now, weekly `pg_dump`-to-Box in Phase 2

## Railway Deployment
- Project: `hoeck-team-dashboard` (id `07664849-ca0a-485a-a579-0ceff99ce6d6`)
- Postgres add-on (managed) — `postgres-volume` mounted at `/var/lib/postgresql/data` (5 GB)
- Daily cron 4 AM Pacific (12:00 UTC) runs `npm run sync:all` (Phase 3 onwards)
- Weekly cron 5 AM Pacific Sunday (13:00 UTC) for `npm run backup:weekly` — **commented out until Phase 2**
- Env vars in Railway dashboard
- Healthcheck path: `/api/health`

## Session Start Ritual (MANDATORY)
1. `git status` — any uncommitted changes?
2. `git log --oneline -10` — where are we?
3. `git stash list` — anything stashed?
4. `git log -1 --format='%cd %s'` — compare to latest "Recent Changes" entry in this file. If git is ahead, reconcile MEMORY.md before doing new work.
5. Read MEMORY.md fully
6. Summarize current status to user
7. Confirm goal for this session before touching code

## Session End Ritual (MANDATORY)
1. Update Current Status, Recent Changes, Known Issues, Next Up
2. `git diff` review of all changes
3. Commit with clear message
4. Push to GitHub
5. Confirm push succeeded before ending
