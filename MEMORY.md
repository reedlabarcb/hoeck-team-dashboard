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
- [x] Phase 1: Foundation + health check — **DEPLOYED & VERIFIED** 2026-05-21
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
- 2026-05-20: Phase 1 committed (`45a48ae`) and pushed.
- 2026-05-21: No-default-credentials rule landed (`d2ef020`) — `scripts/seed-users.ts` requires per-user `SEED_<NAME>_PASSWORD` env vars and skips users whose var is unset. No fallback passwords. AGENTS.md updated with Hard Rule. `secrets-bootstrap.txt` gitignored.
- 2026-05-21: Railway app service `hoeck-team-dashboard` created in the existing project, source = GitHub repo `reedlabarcb/hoeck-team-dashboard@main`. Env vars set: `DATABASE_URL=${{Postgres.DATABASE_URL}}` (reference), `SESSION_PASSWORD` (48-char random), `SEED_REED_PASSWORD` (24-char random, also written to local gitignored `secrets-bootstrap.txt`), `NODE_ENV=production`.
- 2026-05-21: First deploy attempt failed on `pip install -r requirements.txt` (PEP 668 — Nix's immutable `/nix/store`). Fix (`23ed550`): swap pip-based openpyxl install for Nix's `python311Packages.openpyxl`; drop pip from build phase entirely.
- 2026-05-21: **Phase 1 deployed.** Public URL: `https://hoeck-team-dashboard-production.up.railway.app`. Commit `23ed550`. `/api/health` returns 200, aggregate `degraded` (0 failed, 7 warned, 1 ok). Postgres check green: PostgreSQL 18.4, db size ~8 MB, project/environment metadata populated. `startCommand` ran `db:migrate` (3 tables created) + `seed:users` (reed inserted, mike/jack/nadya skipped per env vars) + `next start`. App ready in 69ms.

## Known Issues / Next Up
- **Backup story is incomplete.** Railway Hobby plan has zero Postgres backups. Phase 1 ships `/api/export/all` (manual ZIP) as the only safety net. `scripts/backup-db.ts` is stubbed (pg_dump → local) with `TODO: upload to Box` — full weekly cron to be wired end of Phase 2 once Box OAuth is live. Cron entry in `railway.toml` is commented out until then.
- **Credentials exposed in this transcript — rotate before Phase 7.**
   1. Postgres password (Railway-generated) leaked in initial `railway variables --json` output.
   2. `SESSION_PASSWORD` leaked when verifying env vars via `railway variables --service hoeck-team-dashboard` (CLI shows full values).
   3. `SEED_REED_PASSWORD` leaked the same way.
   All three are acceptable for Phase 1 (empty DB, only Reed seeded, no real data) but MUST be rotated before any client data lands in Phase 7. Rotation procedure: regenerate, `railway variables --service ... --set`, force redeploy. For `SEED_REED_PASSWORD` to actually take effect, the existing users row must be deleted first (seed is `ON CONFLICT DO NOTHING`).
- **Password rotation has no UI yet (Phase 7).** Today the only way to rotate Reed's password is: delete his row in Postgres via Railway DB shell, change `SEED_REED_PASSWORD`, redeploy. We'll add a proper "change password" flow in Phase 7.
- **`secrets-bootstrap.txt` exists locally with Reed's initial password.** Path: `C:\dev\hoeck-team-dashboard\secrets-bootstrap.txt` (gitignored). DELETE this file after Reed has rotated his password.
- **`python_bridge` health check is yellow on Railway.** Nix's `python311Packages.openpyxl` is installed but isn't on the bare `python` binary's `sys.path` — `python -c "import openpyxl"` fails. Acceptable for Phase 1. Fix in Phase 4 by switching to a wrapped python: `(python311.withPackages (ps: with ps; [ openpyxl ]))` in `nixpacks.toml`.
- **shadcn/ui not yet initialized.** Deferred to start of Phase 2 (will run `npx shadcn@latest init` then).
- **Migrations run only on Railway deploy.** CBRE corp firewall blocks outbound TCP to `kodama.proxy.rlwy.net:51241` so `npm run db:migrate` can't run from the dev laptop. `railway.toml`'s `startCommand` is `npm run db:migrate && npm run seed:users && npm start` so it runs every deploy from inside Railway's private network. `/api/health` warns (yellow) instead of fails when Postgres is unreachable from a dev host. **Verified working 2026-05-21 — first deploy ran migrations + seed correctly.**
- **Local dev DB option not yet set up.** If laptop-side UI iteration with live data becomes necessary (probably never in Phase 1, possibly in Phase 2+), spin up Docker Postgres locally and set `DATABASE_URL` to `postgres://localhost:5432/...`. Defer this decision until it actually hurts.

## Next Up
1. **Browser smoke test** (Reed runs): visit https://hoeck-team-dashboard-production.up.railway.app → log in as `reed.labar@cbre.com` with the password in `secrets-bootstrap.txt` → confirm dashboard shell, Backup ZIP download, `/health` page, logout all work. Then rotate Reed's password.
2. **Phase 2 kickoff** (paused until user authorizes): Box developer-console walkthrough → `BOX_CLIENT_ID`, `BOX_CLIENT_SECRET`, `BOX_ACCESS_TOKEN`, `BOX_REFRESH_TOKEN`, `BOX_TENANTS_CHAPMANHOECK_FOLDER_ID`. Then: Box safe wrapper read methods, folder walker w/ convention parsing, `box_folder_index` table, `/files` page, manual "Refresh from Box" re-index. Also wire the `backup:weekly` cron to upload `pg_dump` output to a dedicated Box backup folder (un-comment the cron entry in `railway.toml`).
3. **Phase 4 prep:** switch nixpacks to `python311.withPackages (ps: with ps; [ openpyxl ])` so `python -c "import openpyxl"` works and `python_bridge` goes green.

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
- Postgres service (id `d45dca9d-9345-4660-83ce-aeb8c9a2fc2c`) — `postgres-volume` mounted at `/var/lib/postgresql/data` (5 GB)
- App service `hoeck-team-dashboard` (id `e8aa72d8-9b67-492a-b1c5-e6bb75ea4d3b`) — GitHub-linked to `reedlabarcb/hoeck-team-dashboard@main`, auto-deploys on push
- **Public URL:** https://hoeck-team-dashboard-production.up.railway.app
- **Last deployed commit:** `23ed550` (2026-05-21)
- Daily cron 4 AM Pacific (12:00 UTC) runs `npm run sync:all` (no-op stub until Phase 3)
- Weekly cron 5 AM Pacific Sunday (13:00 UTC) for `npm run backup:weekly` — **commented out until Phase 2**
- Env vars in Railway dashboard (DATABASE_URL is a reference to `${{Postgres.DATABASE_URL}}`)
- Healthcheck path: `/api/health` — returns 200 even when degraded (warnings); 503 only on real failures

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
