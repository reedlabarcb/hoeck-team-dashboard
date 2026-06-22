# Lessons Learned

Every safeguard in `BUILD_SPEC.md` exists because something broke on a prior project. Do not weaken these. They are scar tissue.

## Safeguard ↔ failure map

| Safeguard | Why it exists |
|---|---|
| Postgres on Railway, not SQLite on OneDrive | Golf BD: SQLite corrupted under 2 concurrent edits |
| `DATABASE_URL` env var, not hardcoded path | Golf BD: hardcoded path broke when machine changed |
| Optimistic locking with `version` column | Golf BD: silent overwrites when 2 users edited same row |
| Soft deletes only (`deleted_at`) | Both projects: hard DELETE made recovery impossible |
| Activity feed in Postgres | Both projects: no visibility into what changed |
| Box version history as rollback for Master Excel | Inbound tracker: users feared losing data with no escape hatch |
| Global "Backup All" export button | Inbound tracker: users wanted a snapshot they controlled |
| React Query with refetch-on-focus + polling | Golf BD: Brandon never saw Reed's changes on other tabs |
| "Last updated" timestamp on every view | Golf BD: no way to know if data was fresh |
| `system_state.last_sync_at` polling | Golf BD: background jobs ran, UI didn't know |
| Safe wrappers with forbidden methods absent | Both: SDKs gave full access to destructive operations |
| Git ritual at session start + post-edit | Golf BD: Claude Code reverted weeks of work |
| `health-check.ts` Phase 1 deliverable | Both: no quick "is everything wired?" diagnostic |
| `MEMORY.md` read/update ritual | Both: context evaporated between sessions |

---

## Commit-level findings from prior repos

These are the actual git fingerprints of failures we are NOT going to repeat.

### `reedlabarcb/cbre-golf-bd` (Python FastAPI + React + SQLite on Windows + Railway)

- **OneDrive path bomb** — `config.py:99` hardcoded `_DEFAULT_DB = Path(r"C:\Users\RLabar\OneDrive - CBRE, Inc\Documents\GOLF\cbre-golf-bd\db\bd_agent.db")` as a fallback. The code checked `DATABASE_PATH` env var first, but the fallback would silently break on any machine without that exact OneDrive layout (different Windows account, OneDrive tenant migration, etc.). **This project: no hardcoded fallback. If `DATABASE_URL` is missing, fail loudly.**

- **`156aa51` — "Bulletproof backup: SQLite backup API, verification, 6h interval, restore endpoints"** — Built `sqlite3.backup()` API, pre-mutation backups, corrupt-backup detection, 6h backup daemon, and `/backup`, `/backup/download`, `/backup/list`, `/backup/restore` endpoints. **This project sidesteps all of this by using managed Postgres.** What we keep: the *concept* of user-facing backup endpoints (`/api/export/all`).

- **`efb2980` — "Fix settings persistence on Railway — save to persistent volume"** — `settings.json` was being written to ephemeral `/app` and lost on every Railway redeploy. **This project: zero runtime files on disk. All settings go in Postgres, which lives in Railway's managed volume.**

- **`9b4cf2b` — "Auto-refresh Pipeline tab every 60s for multi-user sync"** — Brandon never saw Reed's changes; fix was polling. **This project: React Query with 30–60s polling per data type + refetch-on-focus + system_state polling for background-job invalidation.**

- **`1ca7202` — "Fix Unauthorized session errors — extend TTL to 7 days, add global 401 reload"** — 8h token TTL locked users out mid-workday; cryptic "Unauthorized" appeared in components. **This project: iron-session `maxAge: 604800` (7 days) + global fetch wrapper that calls `window.location.reload()` on any 401 from `/api/*`.**

### `reedlabarcb/cbre-inbound-tracker` (Next.js + libsql + SQLite on Railway)

- **`0fdcb2f` — "Remove all seeding, auto-restore from backup on empty DB"** — **The single most important commit in this list.** `seed-data.json` was being seeded on every Railway redeploy, *silently overwriting user data*. Fix: removed seeding entirely; if DB is empty on startup, auto-restore from largest backup JSON in `/data/backups/`. **This project: seed scripts use `ON CONFLICT (email) DO NOTHING` and never UPDATE/DELETE existing rows. This is enforced as a Hard Rule in `AGENTS.md`.**

- **`43ac4df` — "Fix data loss: guard seed data, add backup and restore APIs"** — Intermediate fix before `0fdcb2f`: added marker file to prevent re-seeding. **We skip the marker pattern entirely in favor of idempotent seeds.**

- **`a91bc7f` — "Add /api/debug to diagnose volume mount issue"** — Retrofitted endpoint that surfaced `RAILWAY_VOLUME_*` env vars + writable directory test. Built reactively, after a production volume issue. **This project: `/api/health` is built first (Phase 1 deliverable) and includes Railway env metadata + `pg_database_size('railway')` so we never need a separate debug endpoint.**

- **`ec15a33` — "Add output: standalone for Railway volume compatibility"** — Next.js needs `output: 'standalone'` for proper bundling on Railway with volumes. **This project: set in `next.config.ts` from day 1.**

- **Append-only data discipline** — `DATA_MANAGEMENT.md` enforced "Add only. Never UPDATE, never DELETE, never overwrite." **This project: same rule for Master Excel (append-only), same rule for application tables (soft delete via `deleted_at`).**

---

## Lessons NOT yet codified elsewhere

The following came out of mining the prior repos and are worth holding onto even if they're not directly in `BUILD_SPEC.md`:

1. **Hobby-tier Railway has zero Postgres backups.** Verified May 2026 in Railway UI: "Backups are only available for customers on the Pro plan." Our backup story is therefore our responsibility. Phase 1 ships `/api/export/all` (manual ZIP). Phase 2 adds weekly `pg_dump` → Box upload via Railway cron. Until that cron lands, the manual export is the only safety net.

2. **WebSockets on Railway free/Hobby tier are a trap.** Resource caps make them flaky. Golf BD avoided them; we will too. Polling at 30–60s is the answer.

3. **Settings.json (or any runtime file) needs persistent storage.** We don't have any runtime files in this project; everything lives in Postgres. But if we ever add cached lookups, they go in a DB table, not on disk.

4. **Concurrent edits without a `version` column = last-write-wins, silently.** Neither prior project implemented optimistic locking; both relied on "one user at a time" by convention. This project enforces it at the schema level via a Postgres trigger on every editable table.

5. **Diagnostic endpoints want to exist on day 1, not retrofit on day 100.** Inbound tracker had to build `/api/debug` after a volume failure in production. We're shipping `/api/health` and `/health` in Phase 1.

6. **`output: 'standalone'` in `next.config.ts` is required for Railway deployment.** Set at scaffold time.

7. **Seed scripts are idempotent.** `ON CONFLICT DO NOTHING`. Never destructive. Cite `0fdcb2f` in seed-script comments.

8. **iron-session `maxAge: 604800` (7 days).** Anything shorter locks users out mid-workday.

9. **Global 401 handler reloads the page.** Don't let `Unauthorized` surface in a component — reload to the login screen.

10. **DB credentials in tool output stay in the transcript.** Rotate Postgres passwords before any real data lands.

11. **Phase 2 — Postgres connection pool leak in `health-checks.ts`.**
    The original `/api/health` handler created `new Pool()` on every invocation instead
    of using the singleton from `lib/db/index.ts`. TanStack Query polled `/api/health`
    every 15 s, leaking one connection per call. Within ~5 minutes, Postgres rejected
    new connections with error code `53300` (`sorry, too many clients already`), which
    then **masked the actual Box walker bug** — every unrelated query also failed with
    the same error, making the surface symptom look like a walker problem when it was
    actually exhausted connections.

    Compounding factor: `lib/db/index.ts`'s `getPool()` only cached on `globalThis` in
    development (`NODE_ENV !== 'production'`). In production, every call also created
    a fresh `Pool`, so even routes that "used the singleton" leaked.

    **Fix:**
    - Route handlers and library modules must **NEVER** instantiate their own `Pool`.
      Only CLI scripts that exit after completing (e.g. `lib/db/migrate.ts`,
      `scripts/seed-users.ts`, `scripts/backup-export.ts`) may do so.
    - `getPool()` caches on `globalThis` in **all** environments, not just dev.
    - Pool capped at `max: 10` to stay below Railway Hobby Postgres's ~22 connection
      limit, with `connectionTimeoutMillis: 5_000`.

    **Verification:** `git grep -n 'new Pool\|drizzle(' lib/ app/` should show exactly
    one `Pool` creation in `lib/db/index.ts`. Any other line outside `lib/db/` or
    `scripts/` is a leak waiting to happen.

    **Lesson:** always `git grep` for `new Pool` outside `lib/db/` and `scripts/`
    before merging anything that touches the DB. The pre-commit hook now enforces
    this automatically — see `.husky/pre-commit`.

12. **Phase 2 — log-grep monitors are not authoritative; pair every watcher with an endpoint poll.**
    During the async-walker E2E (2026-06-01), I armed a background Monitor to watch for
    `[walker] done walkId=b269b3a0` against the production Railway logs. The watcher
    would have run for hours and never fired because `b269b3a0` is the **jobId**, not the
    **walkId** — the actual walkId was `46058047-…`. The two are separate UUID columns
    on `box_sync_jobs` (`id` vs `walk_id`), and the walker logs `walkId` exclusively. The
    monitor regex didn't match anything the walker emitted, so the watcher was silent and
    falsely appeared "still running" while the walker had in fact completed.

    Worse: even if the IDs had matched, log-grep is fragile to format changes (someone
    renames the log prefix from `[walker] done` to `[walker] complete`, or Railway log
    retention rotates the line out before the polling window reaches it, or the message
    is buried under unrelated noise). Authoritative state lives in Postgres, not stdout.

    **Fix going forward:** any log-grep watcher MUST be paired with a periodic poll
    against the authoritative endpoint (`/api/box/sync/status` in this case, or the
    underlying DB query directly). The endpoint poll is the source of truth; the log
    grep is sugar for surfacing the moment of transition.

    **Pattern template:**
    ```bash
    # Inside a Monitor loop:
    # 1. Hit the authoritative endpoint
    status=$(curl -sS -b "$COOKIE" https://example/api/job/$JOB_ID/status | jq -r .status)
    if [ "$status" = "completed" ] || [ "$status" = "failed" ]; then exit 0; fi
    # 2. Optionally also emit any log lines that crossed a known interesting threshold
    ```

    The poll catches the transition even if the log line is missed (wrong regex, rotated
    out, format changed). The log line, when caught, gives faster latency on the event.
    Both layers together = correct + fast. Either layer alone = unreliable.

    **Lesson:** never trust a single observability channel for terminal-state detection.
    Always layer authoritative-source poll + opportunistic log-grep. When the two
    disagree, the authoritative source wins.

---

## Phase 2.5a — Nix `withPackages` builds the full closure from source on cache-miss (the 40-min torch death)

**Symptom:** Every Railway deploy from P2.5a.6 onward failed. Builds ran ~40 minutes
then died compiling **torch** — a package we never asked for. Build logs showed Nix
gcc-compiling `xarray`, `pandas`, `tables`, `blosc2`, `xlsxwriter`, `scikit-build`,
`pyarrow`, `cmarkgfm` from source. Intermittent: P2.5a.5 (`de6b83c`) deployed fine
on 2026-06-09, then the very next commit (pure TypeScript, no build-config change)
failed — proving it was cache-state-dependent, not code-dependent.

**Root cause:** `nixpacks.toml` installed Python libs via
`(python311.withPackages (ps: with ps; [ openpyxl pdfplumber ]))`. When
`cache.nixos.org` has binary substitutes for the whole closure, this is fast. On a
cache MISS, Nix builds the entire transitive closure **from source** — and many
nixpkgs Python derivations run their test suites (`doCheck = true`) during the build.
`pdfplumber`'s check/propagated inputs pull `pandas`; `pandas`'s checkInputs fan out
to the entire scientific stack including `torch`. So adding one innocuous PDF library
silently dragged in a from-source torch compile that killed the image.

**The full debugging arc (four layered blockers, each hidden behind the previous):**
1. **torch/Nix-from-source** → fixed by leaving Nix for Python entirely: pip-install
   `openpyxl` + `pdfplumber` into a venv at `/opt/venv` using `--only-binary=:all:`
   (prebuilt manylinux/abi3 wheels → ZERO compilation, ~15s). A venv also threads two
   earlier needles: not externally-managed (no PEP 668, which is why `23ed550` had
   originally fled pip for Nix), and packages land on the interpreter's `sys.path`
   (why `17ee228` had switched to `withPackages`). `PYTHON_BIN=/opt/venv/bin/python`
   in Railway env points the TS bridge at the venv interpreter.
2. **`npm ci` exit 1** (revealed once #1 cleared) → Railway's bundled **npm 10.8.2**
   rejects a `package-lock.json` authored by **npm 11**. Real `npm ci` passed locally
   under npm 11, so the lock was in sync — pure generator-version gap. Fix: prepend
   `npm install -g npm@11.16.0` to the install phase.
3. **`next build` postcss/turbopack crash** (revealed once #2 cleared) → Next 16
   turbopack unstable on **node 20**. Fix: bump nixPkgs `nodejs_20` → `nodejs_22`.
4. **`python_bridge` health check warn** → it hardcoded bare `python -c "import
   openpyxl"`, which broke once openpyxl moved into the venv. Fix: probe
   `process.env.PYTHON_BIN` (the interpreter the bridges actually use).

**Also:** `NIXPACKS_NO_CACHE=1` was set temporarily to bust the stuck setup-layer
cache and force the new venv plan to take, then **removed** once proven — leaving it
on injects `nix-collect-garbage -d` + a full re-eval every build, which is slow AND
itself flaky (one build failed purely from this). The Railway **"Agent usage limit
reached"** banner that appeared on failures is a **red herring** — it's Railway's
AI-diagnostic add-on being rate-limited, NOT a build/budget cap. It never blocked or
caused a single build; every failure was a real build-step error.

**Lesson:** On Railway, for any Python dependency beyond trivial pure-Python packages,
prefer **pip wheels in a venv** over Nix `withPackages`. `withPackages` builds the
full dependency closure from source on cache-miss — a single library (pdfplumber)
transitively pulled torch/pandas/xarray and the from-source torch compile killed
every build at ~40 min. pip with `--only-binary=:all:` uses prebuilt manylinux
binaries (zero compilation), is deterministic, and fails fast/loud if a wheel is ever
missing instead of silently falling into a multi-hour source build. Keep
`requirements.txt` pins in lockstep with the `nixpacks.toml` venv install.
