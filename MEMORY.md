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
- RealNex note-author names only resolve for the authed user (Mike): `/Crm/users` = `/users/me` and `/Crm/teams` is self-scoped under the single JWT, so a colleague's `userKey` is unresolvable (needs per-user JWTs / service account — deferred). P3.13 `<RecordHistory>` shows "· by {name}" when resolved (dashboard-logged notes authenticate as Mike → "by Mike Hoeck"), else "· logged in RealNex" — never mislabel a colleague's note as Mike, never blank-ambiguous. Not a code bug; API constraint. (Author-name mapper reads the `userName` field, not `name`.)
- **RealNex jsonb is PascalCase THROUGHOUT — match it in code AND fixtures (2026-07-14, three eyeball-caught bugs on the /companies list).** The mirror stores RealNex/OData objects verbatim, and their nested jsonb uses **PascalCase** keys: address sub-fields = `{Address1, Address2, City, State, ZipCode}` (NOT camelCase); `object_groups` = `[{Key, Name}]`. Three bugs, all surfaced by eyeballing (not the suite):
  1. **PascalCase-vs-camelCase read.** `formatAddress` read camelCase (`address1`/`city`/`zipCode`) → returned "" → every /companies Location **and both detail pages' Address** rendered "—". Fixed `2ef6339`: `formatAddress` now matches keys **case-insensitively** (source-agnostic). Prefer case-insensitive reads for any RealNex jsonb whose casing isn't guaranteed.
  2. **Fixtures must mirror REAL casing.** The address tests PASSED while prod was blank because their fixtures used camelCase — false confidence. **Any test whose fixture stands in for external RealNex data must use the real PascalCase shape.** Verify cheaply against the live API — `sync.realnex.com` is reachable from the corp net with `REALNEX_API_KEY`, a GET is read-only, never print the JWT. Fixtures corrected to PascalCase in `2ef6339`. See auto-memory `feedback_verify_external_jsonb_shape`.
  3. **Route param drift (separate class, same batch).** The /companies group filter did nothing because `GET /api/realnex/companies` never read `?group=` (only q/limit/offset), while the sibling `/contacts` route DID forward it — the filter clause + `object_groups` shape were both correct. Fixed `aca1b8e`: forward `group` + a route test so parallel sibling routes can't silently diverge again. Takeaway: when two sibling routes/pages share a pattern, test that BOTH wire every param.

## Current Status
- [x] Phase 1: Foundation + health check — **DEPLOYED & VERIFIED** 2026-05-21
- [x] Phase 2: Box folder index — **OFFICIALLY STABLE** as of 2026-06-01. End-to-end verified on production after async-walker conversion (P2.15.1–P2.15.5). All 9 E2E steps pass. Final verified walkId `46058047-f6f1-4b1c-87ab-6f8f1e115725` (jobId `b269b3a0-7e03-4e87-8819-38196e7ca9ed`); 27,352 items indexed in 31 min 11 sec at 14.6 items/sec (faster than the original synchronous baseline). Box sync crons were originally in the **invalid `[[deploy.cronJobs]]` format Railway silently ignores**, so for weeks no Box walk fired autonomously (index only as fresh as the last manual walk). **FIXED 2026-07-09** — separate Railway cron services + a `SERVICE_ROLE` dispatcher (schedules set via the GraphQL API): `cron-box-incremental` (daily 12:00 UTC) + `cron-box-full` (Sun 13:00 UTC), **verified firing autonomously 2026-07-10** (box-incremental 12:02 UTC, `triggered_by=cron`). See `docs/RAILWAY_CRON_SETUP.md` + the "Railway cron" lesson in `docs/LESSONS_LEARNED.md`. P2.9 (weekly pg_dump → Box) also deferred to a focused mini-phase.
- [x] Phase 2.5a: PDF content search — **COMPLETE 2026-06-24.** Extraction ran end-to-end (~8.5h on 2026-06-23 + a NUL-byte fix pass on 2026-06-24): **5,948 extracted · 682 scanned · 23 too-large · 23 failed · 0 pending** of 6,676. Content-search E2E verified on production (distinctive phrase → source PDF #1 with `<mark>` highlights; negative → clean empty). Live on `1fbc95d`. See "Phase 2.5a — PDF content search" section below.
- [~] Phase 3: RealNex sync + 4 workflows — **P3.1–P3.4 COMPLETE & LIVE 2026-07-07.** Read-only RealNex→Postgres mirror: safe wrapper (12 GET-only reads, zero write methods — 3-layer enforcement: set-equality test + pre-commit greps + no verb primitive in client), 4-table mirror (`realnex_companies/contacts/groups/sync_jobs`, migrations 0007/0008), in-process patient-worker sync (OData paging + inversion walk for contact→company links), kickoff/status endpoints, `/realnex` UI. First manual sync + idempotency VERIFIED: 1,276 companies / 1,870 contacts / 28 groups / 1,769 links, `rate_limit_hits=0` across ~1,343 calls, zero dupes. Nightly cron: the original `[[deploy.cronJobs]]` config was silently ignored by Railway (PROJECT-WIDE — box crons never fired either — diagnosed 2026-07-08). **FIXED 2026-07-09** via separate Railway cron services + a `SERVICE_ROLE` dispatcher, schedules set via the GraphQL API; `cron-realnex` runs nightly 11:00 UTC — **verified firing autonomously 2026-07-10 at 11:03 UTC** (`triggered_by=cron`). See docs/RAILWAY_CRON_SETUP.md. Linking is SET-ONLY (see Key Decisions — drift caveat + Rebuild-links remedy). Five RealNex API-shape gotchas found on the watched first sync (see docs/code: OData $top≤100, {value} envelope, PascalCase fields, server paging, GUID case). **P3.5 read UIs COMPLETE & LIVE** (2026-07-13): `/companies` + `/contacts` list pages (mirror-read + search/filter/LastSynced badges), the shared `resolveEntities` resolver + `/api/realnex/resolve`, and the reusable keyboard-navigable `<RealNexEntitySearch>` typeahead. **LXD/SF surfacing COMPLETE** (Option A, migration 0009): Lease Expiration + Square Footage live ONLY on `/full` reads (correcting P3.3's "not in RealNex"), so the sync gained a 5th `details` walk phase writing `lease_expiry`+`sq_ft` onto both mirror tables — company LXD = `details.userDataFields.userDate1` VERIFIED via a 35/35 internal cross-check vs contacts' named `leaseExpiry`; first walk enriched ~587 companies / 801 contacts, `rate_limit_hits=0`, full 5-phase sync ~59s; surfaced as columns on both lists. **P3.6 note-logging BUILT + DEPLOYED + SAFETY-PROVEN; live test write deferred by choice — see the dedicated P3.6 line below. Wrapper now exactly 13 methods — 12 GET reads + `appendActivity` (create-only child-History append); set-equality + forbidden (incl. move/re-parent) green.** **Remaining:** Workflow 1 create-company (P3.7), Workflow 2 create-contact (P3.8), Workflow 4 filter+export (P3.11). P3.10 conversational parser DEFERRED (privacy review). rebuildLinks drift remedy is MIRROR-ONLY: it clears our Postgres `company_key` + re-walks; RealNex stays read-only.
- [~] **P3.6 note-logging (the headline write feature) — BUILT, DEPLOYED & SAFETY-PROVEN; the Step 4 live test write was DEFERRED BY CHOICE (2026-07-13).** What's live: the **Log Note** page at `/activities` (nav renamed "Log Note"; Activity Feed stays the audit view); `POST /api/realnex/activity` (auth-gated; validates; `eventTypeKey` restricted to the 6 note types Note 18/Phone Call 1/Cold Call 101/Email 15/Meeting 2/Other 11; audits success AND failure to `activity_feed`); and the `appendActivity` wrapper method (`POST /Crm/object/{key}/history` — add-only child History; commit `81f460d`). Route+UI commits `3092990`, `2fc4193`. **Safety proven:** plant-and-catch confirmed `moveContact`/`deleteCompany`/`updateContact`/`realnexPut` are blocked by BOTH the `safe.test` set-equality/forbidden AND the pre-commit grep; append-only is structural — the HTTP client exposes only `realnexGet` + a path-LOCKED `realnexAppendObjectHistory` (no PUT/PATCH/DELETE, no generic POST) so edit/delete/move/re-parent are UNEXPRESSIBLE, not just forbidden. **Functionally complete + unit-tested** (route + Log Note UI tests mock the write and pass; full suite green). **The one thing NOT done: a real-world confirmation write to the production CRM** — Reed deliberately chose not to write to the live CRM just to watch a verification succeed once. So the write path is **unexercised-on-prod but fully built**; it can be exercised later by Reed/Mike/Nadya on their own CRM whenever they're comfortable. A Cancel on the confirm screen was verified to write nothing (baselined Procopio `D3AAF386…` stayed `totalCount=0`, parent byte-for-byte unchanged). NOTE: `createCompany`/`createContact` were deliberately NOT added — note-logging needs only `appendActivity`; they belong with the P3.7/P3.8 forms.
- [x] **P3.13 Record View — COMPLETE & LIVE 2026-07-14 (HEAD `79f7fce`).** Unified "look up any record → see info + lease data + live RealNex notes → log a note." **Contact + company detail pages** (`/contacts/[key]`, `/companies/[key]`): mirror-sourced profile + LXD/SF + linked contacts (a company shows its contacts, each → contact detail); a live **`<RecordHistory>`** notes feed via `getObjectHistory` — history is read **LIVE, NOT synced** into the mirror; author-name resolution is **PARTIAL by API limit** (only Mike resolves under the single JWT → shows "· by {name}" when resolved, else "· logged in RealNex", never mislabels). **Clickable list rows.** A global **Header search** (`<GlobalRecordSearch>` reusing `<RealNexEntitySearch>` type=both) that NAVIGATES to a record's detail page. **Log Note pre-fill** from URL params (`/activities?type=&key=&name=&company=` pre-selects the entity — the confirm gate is UNCHANGED; pre-fill skips only the search, never the confirmation; success "View" returns to the detail page where history refetches live). All **READ-ONLY; wrapper stays 13.** Commits `8add69c` (data layer + live history route) · `707a04d` (`<RecordHistory>`) · `6725c84` (contact page) · `52e7231` (company page) · `79f7fce` (global search + pre-fill). **Nav bug fixed en route (`54c8fcc`):** `ContactRow`'s company cell linked to `/companies?q=<name>` (→ the filtered LIST) instead of `/companies/[key]` — CompanyRow + ContactProfile were already correct; root-caused by reproducing that framework/prod-build soft-nav works and the deployed commit was right. Added **`detailPath()`** in `lib/realnex/format.ts` as the canonical entity→URL mapping (Header search + Log Note success link) so a record link can't drift back to a list. **Tracked cleanup (NOT urgent — the nav bug is already fixed):** route the remaining inline record-links (`CompanyRow`, `ContactRow`, `ContactProfile`, `LinkedContacts`) through `detailPath` too, to make the single source total. Pure no-behavior-change consolidation.
- [x] Phase 4: Master Excel reads — **OFFICIALLY STABLE** as of 2026-06-01. End-to-end verified on production after iterative P4.1 → P4.9 fixes. All four critical date columns (lease expiration, renewal window start/end, renewal deadline, termination deadline) return correct dates against the real `TT Rep Master Client List 5.20.26.xlsx` (Box file id 2019476118993). Defense-in-depth Y/N filter holds: column-name negative lookahead + column-level + row-level date type guards. Cross-check verified live on production for both Procopio DC (1901 L St) and Downtown (525 B St) → returns the fully-executed lease PDF inside the right `Lease Document(s)` subfolder.
- [ ] Phase 5: Master Excel appends
- [ ] Phase 6: Box folder rename
- [ ] Phase 7: Notes/tags/locking
- [ ] Phase 8: Home + backup + health UI

## Schema
(see `lib/db/schema/`)
- `users` (id, email, name, password_hash, role, created_at, updated_at, version, deleted_at) — Phase 1
- `activity_feed` (id, actor_user_id, action, entity_type, entity_id, payload jsonb, status, created_at) — Phase 1
- `system_state` (key PK, value jsonb, updated_at) — Phase 1
- `user_box_tokens` (id, user_id FK, box_user_id, box_login, access_token_encrypted, refresh_token_encrypted, expires_at, …) — Phase 2; AES-256-GCM via `BOX_TOKEN_ENCRYPTION_KEY`
- `box_folder_index` (id, box_id UNIQUE, box_type enum, name, parent_box_id, depth, path_segments jsonb, year_start/end, deal_type, address, is_mt_client, market_subfolder, is_sublease_shortcut, last_seen_at, last_walk_run_id, …) — Phase 2; mirror of Box folder tree
- `box_sync_jobs` (id, walk_id, status enum, sync_mode enum, is_force_full, started_at, completed_at, progress_folders_walked, progress_files_indexed, api_calls_made, current_path, total_folders_in_index, error_message, triggered_by, delta_cursor [reserved], metadata jsonb, …) — Phase 2 async walker state. CHECK `triggered_by <> ''`. Composite index on (status, updated_at) for fast orphan-recovery scan. `walk_id` correlates with `box_folder_index.last_walk_run_id`.

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
- 2026-05-21: Phase 2 backend code committed (`ed24359`): user_box_tokens + AES-256-GCM crypto, Box OAuth client + token-refresh helper, /api/auth/box/connect + /callback routes, Box safe wrapper read methods (listFolder/getFolder/getFile/getFileVersions/downloadFile/searchFolderTree), folder-name parser, box_folder_index schema, BFS walker. 62/62 vitest pass. `lib/db/index.ts` refactored to lazy-init via Proxy so tests don't need DATABASE_URL.
- 2026-05-21: Phase 2 UI + sync (committing): /files page (browser, breadcrumb, search, click-through), `<ConnectBoxBanner />`, `<BoxRefreshButton />`, /api/box/{connection,folders,reindex} routes, scripts/sync-cron.ts (real impl replaces Phase 1 stubs). Daily cron now indexes Box. Build clean, 14 routes resolved.
- 2026-05-21: Box credentials in Railway env: `BOX_CLIENT_ID`, `BOX_CLIENT_SECRET`, `BOX_TENANTS_CHAPMANHOECK_FOLDER_ID=346493191102`, `BOX_TOKEN_ENCRYPTION_KEY` (32-byte AES-256 base64). All four added to rotate-before-Phase-7 list (CID + secret were exposed in transcript paste, encryption key + folder ID flagged for completeness).
- 2026-05-21: Browser smoke confirmed: login, dashboard shell, /files, "Connect Box" → consent → callback flow all work. First "Refresh from Box" surfaced bigint overflow on `box_folder_index.size_bytes` (Clients folder rollup = ~195 GB, overflows int4).
- 2026-05-26: Bug fix `b2502f8` — size_bytes column migrated integer → bigint(mode: 'number'). Migration 0003_superb_domino.sql.
- 2026-05-26: Bug fix `e541706` — Postgres pool leak in lib/health-checks.ts (created new Pool() per call; TanStack Query polling at 15 s exhausted connections in ~5 min, masked other bugs as 53300 "too many clients"). Refactored to use shared singleton from lib/db; also fixed lib/db/index.ts to cache pool in ALL environments (was dev-only). Pool capped at max: 10 with 5s connectionTimeoutMillis. Pre-commit hook extended (commit `657a019`) to grep for `new Pool(` outside lib/db/ and scripts/. LESSONS_LEARNED.md entry #11 documents the post-mortem.
- 2026-05-26: UX fix (this commit) — walker now logs at start, every 50 indexed items, and on finish. /api/box/reindex route logs entry/exit. Frontend mutation enforces 5-min AbortController timeout so the spinner can't hang forever; on timeout the user sees "Walker timed out — see Activity Feed" with a Retry button. BoxRefreshButton now shows elapsed time (mm:ss) alongside the spinner. /files search input gets `placeholder:text-gray-500` so the placeholder is readable.
- 2026-05-26: **Phase 2 declared stable.** All known bugs resolved; observability in place for future walker issues.
- 2026-05-26: UX — `/files` switched to URL-driven folder navigation. `?folder=<box_id>` is now the source of truth. Browser back/forward works natively. Folder URLs are shareable (e.g., paste in Slack). Direct deep-link loads work (breadcrumb fetched via new `/api/box/folder-chain` endpoint — recursive CTE on `box_folder_index`, one query regardless of depth). ← Back button now delegates to `router.back()`. Suspense boundary added around `FilesPageInner` for `useSearchParams`.
- 2026-05-26: Build hotfix `5851a8d` — `npm run db:migrate` was failing on Railway with `husky: not found` (exit 127). Cause: Nixpacks runs `npm ci` with `NODE_ENV=production`, which skips devDependencies; husky is in devDependencies so the npm `prepare` lifecycle script then fails the whole build. Fix: `"prepare": "husky || true"` — husky still runs locally (devDeps present) but silently no-ops in production.
- 2026-05-27: Phase 2 stability fix #1 (architectural) **STARTED** — synchronous walker holds the HTTP connection for the duration of a full crawl; on the real 181 GB `Tenants - ChapmanHoeck` tree this exceeds the 5-min frontend timeout and never completes. Converting to async background-job pattern: `box_sync_jobs` table holds job state, POST kicks off + returns immediately, in-process worker updates progress, UI polls. **Commit 1 (a949ed8): schema only.** Architecture locked: (a) in-process Next.js worker (no Redis), (i) mark-failed-no-resume orphan recovery on 10-min-stale-`updated_at`, modified_at-filter incremental sync with weekly full walk. See "Key Decisions" below.
- 2026-05-27: **Commit 2 (cd2e41b) — async worker machinery.** `instrumentation.ts` boot hook runs orphan recovery once per process. `lib/external/box/job-runner.ts` provides `createJob`, `getActiveJob`, `getLatestJob`, `kickOffWalk` (fire-and-forget). Walker accepts optional `jobContext` (reports throttled progress) and `incrementalSince` (skips unchanged subtrees). `/api/box/sync` POST returns 202; `/api/box/sync/status` GET feeds the UI poller. `/api/box/reindex` retired to a 307 shim. Production confirmed `[boot] No orphaned sync jobs to recover.` on first boot of the new code.
- 2026-05-27: **Synchronous walker's last full run, recorded for posterity** — 27,234 items in 34 min 22 sec on the real `Tenants - ChapmanHoeck` tree. The frontend's 5-min AbortController fired well before completion but the server-side walk completed successfully — proves the walker code itself is correct. See "Performance Baselines" below.
- 2026-05-27: **Commit 3 (this commit) — UI polling, progress, banners, retry, full-walk modal.** `/files` now polls `/api/box/sync/status` every 5s while a job is queued/running. `BoxRefreshButton` shows live progress (`N folders / M files · current_path`) and elapsed time. Completion banner (`Sync complete — N indexed · incremental walk · M min`) auto-dismisses after 30s. Failure banner has Retry. `<FullWalkConfirmModal />` (Cancel-default-focus, Esc-to-dismiss) gates the explicit "Run full walk →" link. localStorage handoff so navigating away and back to `/files` doesn't flash "no job" before the next poll.
- 2026-05-27: **Folder name typo fix** — "Tenants – ChapmanHoeck" (em-dash) → "Tenants - ChapmanHoeck" (regular hyphen) wherever touched by commits 3-5. Other files (BUILD_SPEC.md, AGENTS.md, docs/Box_Workflow.md, box-folder-index.ts, safe.ts, etc.) get updated when next naturally edited.
- 2026-05-27: **Commit 4 — incremental delta sync + cron wiring.** Job-runner's `kickOffWalk` now resolves `incrementalSince` from the last completed full walk's `started_at` when sync_mode='incremental'. If no prior full exists, silently upgrades to a full and logs (also reflects the upgrade in the box_sync_jobs.sync_mode column for audit honesty). `scripts/sync-cron.ts` rewritten to use the async job-runner pattern (triggeredBy='cron', awaits completion so exit code reflects success). Two cron entries in `railway.toml`: daily 4am Pacific incremental + weekly Sunday 5am Pacific full (catches deletions). `package.json` gets `sync:box:incremental` and `sync:box:full` script entries.
- 2026-06-01: **Breadcrumb probe — bug rediagnosed.** Playwright session against the deployed app confirms the breadcrumb component itself is bug-free at all depths (1 entry at root, 2 entries at depth 2, etc.). The "duplication" in Reed's earlier screenshot was actually: at `/files` root URL with no `?folder` param, `/api/box/folders` returned the root row itself rather than its children — so the breadcrumb said "Tenants - ChapmanHoeck" AND the table's single row also said "Tenants - ChapmanHoeck". Two appearances within the same view = looked like a dup.
- 2026-06-01: **Commit 5 (P2.15.5) — folders route fix + cron disable.** `/api/box/folders` now, when called with no `parent` param, pre-queries for the root row and filters children to its box_id. Empty index still returns []. Result: `/files` root URL now shows the actual children of `Tenants - ChapmanHoeck` (Clients, etc.) instead of the root row itself. Both Box sync crons in `railway.toml` re-commented with explicit re-enable conditions and a placeholder for P2.15.6.
- 2026-06-01: **Phase 2 async-walker conversion code-complete.** P2.15.1 → P2.15.5 all deployed cleanly. Awaits Reed's end-to-end production verification (full walk via UI button, navigate-away/return, deep search) before declaring Phase 2 officially stable. After verification, P2.15.6 re-enables crons.
- 2026-06-01: **End-to-end production verification — ALL 9 STEPS PASS.** Run against deployed commit `6018bca`. Summary:
  - **Step 1** `/files` root URL shows root's children (24 rows: 19 folders + 5 files) — root-row-as-only-table-entry bug fixed.
  - **Step 2** Refresh button POST `/api/box/sync` returns 202 with new jobId; button flips to `Syncing… mm:ss` with live counter; server status='running'.
  - **Step 3** Navigate Home → return to `/files` mid-sync. localStorage `hoeck.activeBoxSyncJobId` preserved across navigation; counter resumes; server progress continued advancing.
  - **Step 4** On terminal state, completion banner reads `"Sync complete · 27,480 items now indexed · Full walk · 31 min ×"`. localStorage cleared automatically.
  - **Step 5** Search "procopio" returns 94 matches including 6-deep PDFs (e.g. `2023 0517 Procopio, Cory, Hargreaves & Savitch LLP Executed Lease.pdf`).
  - **Step 6** Deep-link `/files?folder=346719171935` renders correct 6-entry breadcrumb (`Tenants - ChapmanHoeck / Clients / Procopio - MT / Sottsdale, AZ / 2023 - Lease Acquisition - 4800 N Scottsdale / Lease Document(s)`). Click "Clients" breadcrumb segment correctly truncates URL+chain to depth 2.
  - **Step 7** "Run full walk →" link opens confirmation modal. Title `"Run a full walk?"`. Cancel button has `autoFocus`. Both buttons present.
  - **Step 8** `Escape` key dismisses modal; no server-side job started.
  - **Step 9** Fetch interception (Playwright `window.fetch` monkey-patch) confirms "Yes, run full walk" click would POST to `/api/box/sync?mode=full`. No actual second walk executed (synthetic 202 returned client-side). Server confirms no new job leaked.
  - Walker metrics: 27,352 indexed, 31 min 11 sec, 6,806 Box API calls, 14.6 items/sec — recorded in Performance Baselines.

## Phase 4 — Master Excel reads (STABLE 2026-06-01)

**Final commit hashes**
- P4.1 Python bridge + tests
- P4.2 TS safe wrapper + Box file fetcher
- P4.3 `/api/master-excel/lookup` route
- P4.4 `/master-excel` UI page
- P4.5 health-check live probe upgrade
- P4.6 expose `headers` + `rawHeaders` in lookup response (diagnostic)
- P4.7 `0d63f86` — real-column HEADER_PATTERNS + (Y/N) negative lookaheads + column-level & row-level date type guards + production-mirror pytest fixtures + dated docstring header
- P4.8 `609358a` — alias `renewal_deadline` ← `renewal_window_end` when no discrete deadline column (production file has none; OPTION DATES CLOSE doubles as deadline)
- P4.9 `18a2f39` — cross-check 500 fix: swap `sql\`${col} = ANY(${arr})\`` (which spreads array params) for Drizzle's `inArray()` (binds single array)
- Force-rebuild empty commits `17cc781`, `2f85d6a`, `aa19921` — Nixpacks layer cache wouldn't pick up `.py`/route changes without forcing fresh build

**Real column-name mapping (TT Rep Master Client List 5.20.26.xlsx, Box file id 2019476118993, snapshot 2026-06-01)**
| Col | Real header | Field |
|----:|-------------|-------|
| 0 | `CLIENT` | client |
| 1 | `Address` | address |
| 2 | `SQUARE FOOTAGE` | space_sf |
| 3 | `LEASE EXPIRATION DATE` | lease_expiration |
| 4 | `RENEWAL OPTION (Y/N)` | *intentionally unmatched (Y/N flag)* |
| 5 | `OPTION DATES OPEN` | renewal_window_start |
| 6 | `OPTION DATES CLOSE` | renewal_window_end **+ renewal_deadline (P4.8 alias)** |
| 7 | `TERMINATION OPTION (Y/N)` | *intentionally unmatched (Y/N flag)* |
| 8 | `TERMINATION DATE` | *unmatched in v1 (no field for "effective termination date" — defer to Phase 4.1 if Mike asks)* |
| 9 | `TERMINATION NOTICE` | termination_deadline |
| — | *(no Market column)* | market falls back to parens in CLIENT (e.g., `Procopio (DC)`) |

**Live E2E results (production, 2026-06-01)**
- `GET /api/master-excel/lookup?client=Procopio` → 5 rows (Scottsdale, DC, Downtown, Del Mar, Irvine) with correct dates. Procopio DC matches the docs/Box_Workflow.md spec example exactly: `renewalWindowEnd` = `renewalDeadline` = `2026-07-28T00:00:00` ("the option date closes 7/28/2026" per spec).
- `terminationDeadline` returns `null` for rows where the TERMINATION NOTICE cell is blank (no Y/N leakage anywhere); returns real date only where the cell holds a real datetime (Procopio Del Mar: `2024-08-01T00:00:00`).
- Fuzzy match `?client=proc` → same 5 Procopio rows. Case-insensitive contains works.
- No-match `?client=ZZZ_NoSuchClient_XYZ` → 200, `matchCount: 0`, empty `rows: []`. Clean empty state, no error.
- `GET /api/master-excel/cross-check?client=Procopio&address=1901%20L%20St` → `match: true`, file = `FE (91128543_12) TMG - 1901 L - Procopio Lease.docx.pdf` at path `Clients/Procopio - MT/Washington DC/2022 - Lease Acquisition - 1901 L St/Lease Document(s)/`. Score=2 ("executed" match).
- `GET /api/master-excel/cross-check?client=Procopio&address=525%20B%20St` → `match: true`, file = `Fully Executed Lease Agmt-Procopio EH20026339.pdf` in the 525 B St deal folder. Score=2.

**Deferred (Phase 4.1, none blocking)**
- `TERMINATION DATE` (col 8) currently has no destination field. If Mike asks for "what date does termination actually take effect," add `termination_effective_date` to RowDict + pattern.
- `PROSPECTS` sheet of the workbook is unread (only the primary `CLIENTS` sheet is parsed). Defer to Phase 4.1 if needed for prospect workflows.
- Sheet name typo `Sottsdale, AZ` in Box left as-is per Phase 2 "faithfully mirror Box" rule.

## Phase 2.5a — PDF content search (COMPLETE 2026-06-24)

**State:** DONE. Extraction ran end-to-end; content search verified working on production.
Final `box_folder_index` distribution (6,676 PDFs):
`extracted=5948 · scanned=682 (skipped_scanned, image-only) · too_large=23 (>50 MB) ·
failed=23 (genuinely unextractable: corrupt/encrypted) · pending=0`.

**Extraction E2E timeline:**
- **2026-06-23** — first full run, ~8.5h (18:00→02:37 UTC), 5,900 extracted. Triggered via
  authenticated POST `/api/box/extract-text`; processed sequentially (~10-15 PDF/min;
  download from Box + pdfplumber + DB write per file). 48 left `pending`.
- **2026-06-24** — the 48 stragglers (a batch of web-saved news-article PDFs indexed by a
  Box cron mid-run) all failed on a NUL-byte write error; fixed (`3d56cb6` + `1fbc95d`)
  and re-kicked → all 48 extracted, **pending=0**.

**Content-search E2E verification (2026-06-24, production):**
- `GET /api/box/folders/search?q="PERKINS COIE ANALYSIS SUMMARY BY COMPONENT"` → source
  PDF `PerkinsCoie_PitchDeck_v02_AS_draft3.pdf` ranked **#1** with snippet
  `<mark>PERKINS</mark> <mark>COIE</mark> <mark>ANALYSIS</mark> <mark>SUMMARY</mark> BY <mark>COMPONENT</mark> | MARCH 15, 2017 …`.
- Distinctive proper nouns rank their source #1 (`"Perkins Coie"` rank 3.88; `"NXP
  Semiconductors"` → its doc). Negative nonsense phrase → 0 results (clean empty).
- Ranking note: route uses `plainto_tsquery` + `ts_rank_cd` (bag-of-words, frequency-
  weighted) — a *common* phrase's source can rank #2 behind a longer doc; expected, not a
  bug. (If exact-phrase-#1 ever matters, switch to `phraseto_tsquery`.)

**NUL-byte fix (`3d56cb6`, deployed `1fbc95d`):** Postgres `text` columns reject `0x00`.
~48 web-print PDFs (Bloomberg / Investing.com print-to-PDF) embed NUL bytes; pdfplumber
extracted them fine but the DB write threw `invalid byte sequence for encoding "UTF8":
0x00`, and the error-recording write ALSO threw (the message embedded the same NULs), so
rows stuck `pending`. Fix, defense-in-depth: strip `\x00` at the source in
`pdf_extract_text.py` AND via `stripNul()` on both `extracted_text` and `extraction_error`
in `text-extractor.ts`. pytest regression added. (Build note: the fix commit `3d56cb6`
first failed because a PowerShell `Set-Content -Encoding utf8` left a UTF-8 BOM on the
`.ts` file — turbopack on Railway/node22 rejected it though local node26 tolerated it;
stripped in `1fbc95d`.)

**What's live (commit `1fbc95d`, 2026-06-24):**
- All P2.5a commits: `.1` schema/migration → `.2` pdf_extract_text.py → `.3` worker →
  `.4` API routes → `.5` `?content=` FTS → `.6` /files UI → `.7` backfill+health-check.
- `migration 0006` ran on production: every PDF row in `box_folder_index` backfilled to
  `extraction_status='pending'`. Confirmed via `/api/health` → `text_extraction`:
  `total_pdfs=6676 extracted=0 pending=6676 scanned=0 too_large=0 failed=0 null_status=0`
  (null_status=0 proves the backfill applied; pending=6676 is the work queue).
- `python_bridge` health check: **ok** — `python + openpyxl + pdfplumber present
  (/opt/venv/bin/python)`. Proves the venv interpreter works in the live image.
- `text_extraction` health check: **ok** — proves P2.5a.7 code is live.

**Deploy-blocker resolution (the 2026-06-18 saga — full detail in docs/LESSONS_LEARNED.md):**
Four layered blockers, each hidden behind the previous, all fixed:
1. **torch/Nix-from-source** (`6fa81c1`/`b83a9fd`) — `python311.withPackages` built
   pdfplumber's transitive closure from source on cache-miss, dragging in
   torch/pandas/xarray; the torch compile killed every build at ~40 min. Fix: switched
   Python deps to **pip wheels in a venv** at `/opt/venv` (`--only-binary=:all:`, zero
   compilation). `PYTHON_BIN=/opt/venv/bin/python` set in Railway env.
2. **`npm ci` exit 1** (`2a5935f`) — Railway npm 10.8.2 rejected the npm-11-authored
   lockfile. Fix: `npm install -g npm@11.16.0` before `npm ci`.
3. **`next build` postcss/turbopack crash** (`47a7641`) — Next 16 turbopack unstable on
   node 20. Fix: nixPkgs `nodejs_20` → `nodejs_22`.
4. **`python_bridge` warn** (`c8619e1`) — health check probed bare `python`, not the
   venv. Fix: probe `process.env.PYTHON_BIN`.
- **`NIXPACKS_NO_CACHE=1`** was set temporarily to bust the stuck setup-layer cache so
  the venv plan would take, then **removed** (`8810303` = clean cached rebuild that
  succeeded, proving the pipeline is stable without it). Leaving it on slows every build
  and is itself flaky.
- The Railway **"Agent usage limit reached"** banner seen on failed deploys was a **red
  herring** — Railway's AI-diagnostic throttle, NOT a build/budget cap. Never blocked a
  build; ignore it.

**Follow-ups (none blocking):**
- **Re-extraction is incremental + safe to re-run** — the worker only selects
  `extraction_status='pending'`, so POST `/api/box/extract-text` (force) picks up only new
  PDFs added by future Box syncs. The 23 `failed` rows stay `failed` (not retried) unless
  flipped back to `pending`; they're genuinely unextractable (corrupt/encrypted) so leave them.
- **OCR for scanned PDFs** = Phase 2.5b (the 682 `skipped_scanned` are image-only).
- **Cron** (`railway.toml`, commented `P2.5a.7b`) can be enabled to auto-extract new PDFs
  on a schedule now that the manual E2E is proven.

**Both API entry points require an auth session** (getSession().user) — POST/GET
`/api/box/extract-text*` return 401 unauthenticated. Kick via a logged-in browser
(Playwright) or the /files UI button, not a bare curl.

## RealNex API — Discovery (COMPLETE 2026-06-17, Phase 3 build not started)

**Spec:** `https://sync.realnex.com/swagger/v1/swagger.json` — OpenAPI 3.0.1,
title "RealNex SyncAPI Data Facade" v1.0, **164 endpoints** across 14 tags.
Committed to `docs/RealNex_API_Docs/swagger.json` (1.4 MB raw) +
`docs/RealNex_API_Discovery.md` (human-readable reference). Commit `7d572f1`.

**Base URL:** `https://sync.realnex.com` (no `servers` block in spec; host = spec host).
- ⚠️ NOT `api.realnex.com` / `app.realnex.com` / `core.realnex.com` — those were
  blind guesses from earlier probing and are the WRONG hosts. They're also blocked
  by CBRE Zscaler at the CONNECT layer (HTTP 500 on tunnel), which sent us down a
  hotspot rabbit hole. **`sync.realnex.com` IS allowed through CBRE Zscaler** — no
  hotspot needed. Confirmed by curl (1.4 MB spec pulled) + the smoke test below.

**Auth:** Bearer JWT. `components.securitySchemes.Bearer = {type:http, scheme:bearer,
bearerFormat:JWT}`; top-level `security: [{Bearer:[]},{Basic:[]}]`. Header:
`Authorization: Bearer <jwt>`. JWT lives in `.env.local` as `REALNEX_API_KEY`
(gitignored, never committed). Token is scoped to **Mike Hoeck's** account
(`name: "Mike Hoeck"`, `email: mike.hoeck@cbre.com`), `exp` ~year 2038 (no near-term
rotation). All reads/writes via this token attribute to Mike in RealNex audit log —
Phase 3 multi-user will need per-user JWTs or a service account.

**Smoke test (2026-06-17):** `GET https://sync.realnex.com/api/Client?api-version=1.0`
with Bearer JWT → **HTTP 200**, returned `ClientInfo` `{id (73-char account:user
key), type:"Crm", clientName:"mike.hoeck@cbre.com"}`. Confirms base URL + auth +
token validity + corp-network reachability. Ran via tsx one-liner with undici
ProxyAgent (HOECK_USE_PROXY=1), JWT read from env (never in argv). One request only,
no writes, no enumeration.

**Node-fetch-through-proxy:** Node's built-in fetch does NOT honor HTTP_PROXY the way
curl does. `scripts/realnex-discovery.ts` (uncommitted, now mostly obsolete) wires
`undici`'s ProxyAgent gated on `HOECK_USE_PROXY` env flag. `undici@8.5.0` is a
committed devDep (commit `42f0422`). For Phase 3 production on Railway, NO proxy
plumbing is needed — Railway's egress isn't behind CBRE Zscaler.

**Two gotchas for Phase 3 build:**
1. **No company-list endpoint outside OData.** `CrmCompany` has GET-by-key, POST,
   PUT, DELETE, and `/contacts`, but no "list all" or "search by name". Workflow 1's
   company search must use the `CrmOData` tag (`/api/v1/Crm/odata/…`) OR a nightly
   Postgres mirror. Contacts DO have `/api/v1/Crm/contact/autocomplete?Term=`.
2. **History (activity) writes are object-scoped.** Create an activity via
   `POST /api/v1/Crm/object/{objectKey}/history` (auto-links to parent
   company/contact) — preferred over top-level `POST /api/v1/Crm/history` which
   then needs a separate `.../object` association call. Read a record's activity
   feed via `GET /api/v1/Crm/object/{objectKey}/history` (paginated).

**Phase 3 safe-wrapper mapping** (see Discovery doc §8): `listCompanies`→OData/mirror,
`getCompany`→`GET .../company/{key}/full`, `createCompany`→`POST .../company`,
`listContacts`/`getContact`/`createContact`→contact endpoints, `listActivities`→
`GET .../object/{key}/history`, `getActivity`→`GET .../history/{key}`,
`createActivity`→`POST .../object/{key}/history`, `listGroups`→`GET .../group`.
Forbidden methods (updateCompany/deleteCompany/etc.) still banned by safe.test.ts
even though PUT/DELETE exist in the API.

## Known cleanups for Phase 2.1
Small follow-ups identified during the async-walker conversion. None blocking.
- **`box_sync_jobs.is_force_full` semantic ambiguity.** Currently set true whenever the effective walk is full, including the first-ever full when no prior completed walk exists (auto-upgrade path). Should mean strictly "user-initiated via the ?force=true / 'Run full walk →' modal." Audit logs need this distinction. Fix in P2.1.x: split into `is_force_full` (user-initiated) and `is_auto_upgraded` (because no prior full existed).
- **P2.15.6 — Box sync crons re-enabled in `railway.toml` (DONE 2026-06-01, but INEFFECTIVE).** Both Box crons were uncommented, but in the invalid `[[deploy.cronJobs]]` array format Railway ignores — so they have never fired. Superseded by the cron-fix work (option A: separate Railway cron services). See Railway Deployment + `docs/LESSONS_LEARNED.md` "Railway cron".
- **P2.9 — weekly pg_dump → Box backup cron.** Closes the Hobby-tier-no-Postgres-backups gap. Stub at `scripts/backup-db.ts` (pg_dump → local file) with TODO for Box upload. To be implemented as a focused mini-phase.

## Known Issues / Next Up
- **Backup story is incomplete.** Railway Hobby plan has zero Postgres backups. Phase 1 ships `/api/export/all` (manual ZIP) as the only safety net. `scripts/backup-db.ts` is stubbed (pg_dump → local) with `TODO: upload to Box` — full weekly cron to be wired end of Phase 2 once Box OAuth is live. Cron entry in `railway.toml` is commented out until then.
- **Credentials exposed in this transcript — rotate before Phase 7.**
   1. Postgres password (Railway-generated) leaked in initial `railway variables --json` output.
   2. `SESSION_PASSWORD` leaked when verifying env vars via `railway variables --service hoeck-team-dashboard` (CLI shows full values).
   3. `SEED_REED_PASSWORD` leaked the same way.
   All three are acceptable for Phase 1 (empty DB, only Reed seeded, no real data) but MUST be rotated before any client data lands in Phase 7. Rotation procedure: regenerate, `railway variables --service ... --set`, force redeploy. For `SEED_REED_PASSWORD` to actually take effect, the existing users row must be deleted first (seed is `ON CONFLICT DO NOTHING`).
- **Password rotation has no UI yet (Phase 7).** Today the only way to rotate Reed's password is: delete his row in Postgres via Railway DB shell, change `SEED_REED_PASSWORD`, redeploy. We'll add a proper "change password" flow in Phase 7.
- **`secrets-bootstrap.txt` exists locally with Reed's initial password.** Path: `C:\dev\hoeck-team-dashboard\secrets-bootstrap.txt` (gitignored). DELETE this file after Reed has rotated his password.
- ~~**`python_bridge` health check is yellow on Railway.**~~ Fixed in P2.16 — `nixpacks.toml` now uses `python311.withPackages (ps: with ps; [ openpyxl ])` so `import openpyxl` works on the bare python.
- **shadcn/ui not yet initialized.** Deferred to start of Phase 2 (will run `npx shadcn@latest init` then).
- **Migrations run only on Railway deploy.** CBRE corp firewall blocks outbound TCP to `kodama.proxy.rlwy.net:51241` so `npm run db:migrate` can't run from the dev laptop. `railway.toml`'s `startCommand` is `npm run db:migrate && npm run seed:users && npm start` so it runs every deploy from inside Railway's private network. `/api/health` warns (yellow) instead of fails when Postgres is unreachable from a dev host. **Verified working 2026-05-21 — first deploy ran migrations + seed correctly.**
- **Local dev DB option not yet set up.** If laptop-side UI iteration with live data becomes necessary (probably never in Phase 1, possibly in Phase 2+), spin up Docker Postgres locally and set `DATABASE_URL` to `postgres://localhost:5432/...`. Defer this decision until it actually hurts.

## Next Up
1. **Phase 2 browser smoke** (Reed runs): visit https://hoeck-team-dashboard-production.up.railway.app/files → click "Connect Box" → grant consent on Box → redirected back to /files → click "Refresh from Box" → tree appears → drill into a client folder → click a file → opens in Box new tab. Verify /api/box/connection returns `connected: true` and shows correct `box_login`.
2. **Phase 2.9 (deferred):** weekly pg_dump → Box backup cron. Implementation: choose/create a `dashboard-backups` subfolder in `Tenants - ChapmanHoeck`, use Box upload API to push the SQL dump as a new file (versioned), uncomment the weekly cron in `railway.toml`. Closes the Hobby-tier-no-Postgres-backup risk.
3. **Phase 3:** RealNex sync + 4 workflows. Blocked on RealNex admin access being granted to Jack/Mike/Nadya + API key from Reed's account.
4. **Phase 4 prep:** switch nixpacks to `python311.withPackages (ps: with ps; [ openpyxl ])` so `python -c "import openpyxl"` works and `python_bridge` goes green.

## Performance Baselines
Recorded so future sessions can detect regressions. Numbers are from the actual production deployment, not estimates.

- **Full Box walk (synchronous, pre-async conversion)** — 27,234 items indexed in 34 min 22 sec (2,062,382 ms) against the real `Tenants - ChapmanHoeck` tree (~181 GB, depth 6). API call count not captured for this run. Throughput ≈ 13.2 items/sec. The walker code itself was correct; the only thing fighting it was the frontend's 5-min HTTP timeout — which is why we converted to async.
- **Full Box walk (async pattern, P2.15.x)** — 27,352 items in 31 min 11 sec (1,870,807 ms), 6,806 Box API calls, throughput **14.6 items/sec**. Triggered by user via `/files` Refresh button → POST `/api/box/sync` → fire-and-forget walker. UI polled `/api/box/sync/status` every 5s; user navigated away mid-walk and back without disruption (localStorage handoff). On completion, the `box_sync_jobs` row's `total_folders_in_index` reflected the full table count (27,480 — slightly higher than walked count due to a few residual rows from earlier walks that the current walker hadn't yet overwritten). Verified jobId `b269b3a0-7e03-4e87-8819-38196e7ca9ed` / walkId `46058047-f6f1-4b1c-87ab-6f8f1e115725` on 2026-06-01.
- **Postgres DB size after full walk** — ~23.7 MB at first full walk. Negligible additional growth on subsequent walks (UPSERT-only schema).
- **Incremental walk** — not yet measured on real data. Expected based on architecture: 1-3 min once steady-state, since most subtrees have `modified_at < incrementalSince` and get skipped.
- **App boot (warm cache)** — `Ready in 66-155ms` after migrate + seed.
- **Migration count** — 4 migrations applied (`users/activity_feed/system_state`, `user_box_tokens`, `box_folder_index`, `box_sync_jobs`).
- **Master Excel lookup latency (production, 2026-06-01, P4.9 deploy)** — `GET /api/master-excel/lookup?client=Procopio`: cold path **1258 ms** (Box `getFile` metadata + `downloadFile` + Python subprocess spawn + openpyxl parse on 5.20.26 xlsx); warm path **355–435 ms** (file cached locally on disk under 5-min TTL + etag-revalidated, but Python subprocess still re-parses on every call — future optimization opportunity: serve from `cached.parsedAll` for repeated lookups on the same etag). Both ranges acceptable for UI use. Cross-check route adds ~50–100 ms (three index queries against `box_folder_index`).

## Key Decisions
- Postgres (managed Railway), not SQLite — directly motivated by golf-bd SQLite-on-volume backup machinery (commit `156aa51`)
- React Query with 30s staleTime, refetch-on-focus
- No Master Excel cache (live reads, infrequent)
- Append-only Master Excel v1
- Activity feed = UI surface; RealNex + Box are real history
- Password auth (no SSO); iron-session 7-day cookies
- Python bridge for openpyxl (Phase 4)
- Folder rename only for adding address to deal folders (`renameDealFolder`, scoped)
- ~~Conversational parser via Anthropic API (Workflow 3, Phase 3)~~ — Anthropic dropped 2026-05-21; structured form only for Workflow 3, manual date entry for Phase 5 lease filing
- `/api/export/all` = peace of mind, not primary rollback
- Backup strategy: manual export now, weekly `pg_dump`-to-Box in Phase 2
- **Box folder walker = in-process Next.js worker (no Redis, no separate service).** State in `box_sync_jobs` Postgres table. Decided 2026-05-27 for the async-job conversion. Trade-off accepted: app redeploys mid-walk lose the walk (mitigated by orphan recovery).
- **Orphan recovery = mark-failed-no-resume.** On app startup, any `box_sync_jobs` row with `status='running' AND updated_at < NOW() - INTERVAL '10 minutes'` is marked `failed` with `error_message='orphaned by process restart'`. Walker is fast enough that retry-from-scratch is cheaper than checkpoint/resume complexity.
- **Incremental sync = modified_at filter, NOT Box Events API (v1).** Subsequent walks skip subtrees whose `modified_at` predates the last successful full walk. Doesn't catch deletions — a weekly Railway cron does a full walk to reconcile. Deferred Events API + cursor management to "when this becomes painful, not before."
- **RealNex mirror linking is SET-ONLY (P3.4, v1) — links can DRIFT.** The nightly inversion walk only SETS `realnex_contacts.company_key` (from `GET /api/v1/Crm/company/{key}/contacts`); it never re-points or clears an existing link. So if a contact is re-associated (A→B) or un-associated in RealNex, nightly runs will NOT correct the mirror's stale `company_key` — the mirror's links slowly drift from RealNex truth. **Accepted for v1** (this 3-person team mostly ADDS contacts; drift is slow + low-impact, and the mirror's primary job — company names, contact info, who-works-where-mostly — is served well). **Remedy exists + is tested:** a full link rebuild — the "Rebuild links" button on `/realnex`, or `POST /api/realnex/sync?rebuildLinks=true` — NULLs every `company_key` first, then re-walks so that run converges the mirror to RealNex truth (contacts under no company end up NULL). Run manually when drift accumulates (or schedule monthly later). **Path 2** (make every nightly run authoritatively self-converge) is a known future refinement. Decided 2026-07-07 with Reed, enabling the cron with eyes open.
- **Note-logging = LOCAL-FIRST structured entry; it is the headline WRITE feature (2026-07-07).** Reed's core dashboard use is logging a history note onto a contact/company (e.g. "had lunch with Maria, her daughter's going to Berkeley"). Built with **NO LLM, NO external text exposure**: (1) local autocomplete resolves the contact/company against the synced mirror — instant, no network, and the **highest-consequence step** (resolving the right person locally prevents logging to the WRONG contact); (2) event-type pick (Note/Meeting/Call/Email); (3) verbatim note body; (4) confirm-before-write. Works for **contacts AND companies**. It is a WRITE to RealNex — a CREATE of a History/Activity **APPENDED to an existing** record (`appendActivity` → `POST .../object/{key}/history`) — the ALLOWED child-append, **NOT a parent edit** (reconfirm when P3.6 create methods land; consistent with the write-safety model). **PRIORITY:** the create-History path (P3.6 create methods + P3.9 log-note form) is the #1 write feature ("the whole point of the dashboard"); **P3.5 read UIs are secondary but FEED the autocomplete** (P3.5 mirror data → the note resolver). **P3.10 conversational LLM parser stays DEFERRED** — single-note usage, not multi-entity brain-dumps; no `ANTHROPIC_API_KEY`; "Anthropic dropped" stays authoritative; revisit only if multi-entity freeform logging becomes a real need.

## Railway Deployment
- Project: `hoeck-team-dashboard` (id `07664849-ca0a-485a-a579-0ceff99ce6d6`)
- Postgres service (id `d45dca9d-9345-4660-83ce-aeb8c9a2fc2c`) — `postgres-volume` mounted at `/var/lib/postgresql/data` (5 GB)
- App service `hoeck-team-dashboard` (id `e8aa72d8-9b67-492a-b1c5-e6bb75ea4d3b`) — GitHub-linked to `reedlabarcb/hoeck-team-dashboard@main`, auto-deploys on push
- **Public URL:** https://hoeck-team-dashboard-production.up.railway.app
- **Last deployed commit:** `79f7fce` (2026-07-14, P3.13 Record View complete) — auto-deploys on every push to main
- Cron jobs: run as SEPARATE Railway services (one per job), NOT `railway.toml` cronJobs. Each deploys from this repo and routes via the root `railway.toml` dispatcher `scripts/start-dispatch.sh` branching on a `SERVICE_ROLE` env var: `cron-realnex` (realnex, `0 11 * * *`), `cron-box-incremental` (box-incremental, `0 12 * * *`), `cron-box-full` (box-full, `0 13 * * 0`). Web service sets no SERVICE_ROLE → unchanged web command. Backup + extract-text crons deferred (also future separate services).
  - **History → RESOLVED 2026-07-09.** The original `[[deploy.cronJobs]]` array NEVER fired (not a real Railway feature — only a single `deploy.cronSchedule` per service works); box index was silently stale ~30 days (fixed by a manual full walk 2026-07-08). Per-service dashboard start-command + config-file fixes then failed (config-as-code overrides dashboard; per-service config paths didn't apply) → **SERVICE_ROLE dispatcher** is the working design. **PROVEN**: cron-realnex fired via cron incl. an autonomous `0 0 UTC` run; cron-box-incremental fired via cron (after fixing a BOM that PowerShell `railway variable set --stdin` prepended to `BOX_TENANTS_CHAPMANHOECK_FOLDER_ID`). `checkRealNexMirror`/`checkBoxMirror` in `/api/health` expose per-mirror freshness + `triggered_by=cron` proof. **ALL GREEN 2026-07-09:** dashboard `cronSchedule` edits would NOT persist (even with Apply — 4+ tries), so schedules were set via the Railway **GraphQL API** (`serviceInstanceUpdate{cronSchedule}`, `Bearer $env:RAILWAY_API_TOKEN`, `backboard.railway.app/graphql/v2`) + **`railway up`** (fresh deploy bakes the manifest; `railway redeploy` just replays the old one). All 3 are Online Cron jobs, build-and-wait: realnex `0 11`, box-incremental `0 12`, box-full `0 13 * * 0`. Setup + 8 gotchas + the API method: `docs/RAILWAY_CRON_SETUP.md`.
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
