# Railway cron services setup — Option A (3 dedicated services)

**Why:** `railway.toml` `[[deploy.cronJobs]]` arrays are silently ignored by Railway — it
runs only a single `deploy.cronSchedule` per service (executing that service's start
command). See `docs/LESSONS_LEARNED.md` "Railway cron". Fix = one Railway service per
scheduled job.

All three services deploy from the **same repo/branch as the web app**
(`reedlabarcb/hoeck-team-dashboard`, `main`), share the same Postgres, and each runs its
sync script once on schedule then exits (`scripts/sync-cron.ts` already awaits the job to
completion then `process.exit(0/1)` — correct for the one-shot cron model).

---

## Step 0 (do first) — promote shared secrets to Railway Shared Variables

Project → **Variables → Shared Variables**. Add these once so the web service + all 3 cron
services draw from one source (rotation = one edit, not four):

- `REALNEX_API_KEY`
- `BOX_CLIENT_ID`
- `BOX_CLIENT_SECRET`
- `BOX_TENANTS_CHAPMANHOECK_FOLDER_ID`
- `BOX_TOKEN_ENCRYPTION_KEY`

Then tick the relevant shared vars into each service (below). NOT needed by these crons:
`SESSION_PASSWORD`, `BOX_MASTER_EXCEL_FILE_ID`, `REALNEX_API_BASE_URL` (client defaults to
the right host).

---

## Common settings for ALL 3 services

- **Source:** GitHub `reedlabarcb/hoeck-team-dashboard`, branch `main` (same as web).
- **Build:** leave **DEFAULT** (nixpacks). The repo's `nixpacks.toml` already runs
  `npm ci --include=dev`, so `tsx` (a devDependency the sync script needs) is installed.
  v1 = reuse the proven build. It also runs `next build` + the Python venv, which these
  crons don't use — harmless, ~2-3 min of wasted build time. *(Later optimization: override
  the build to skip `next build` + Python.)*
- **Auto-deploy: RECOMMEND OFF** per cron service (detach from "Deploy on push"). Otherwise
  every push to `main` rebuilds all 4 services (web + 3 crons) = 4× build minutes. Redeploy
  a cron service manually only when its code changes (rare). ← your call.
- **Healthcheck:** none. These are one-shot cron runs, not web servers — leave the
  healthcheck path EMPTY (do not copy the web `/api/health` healthcheck, or the run will be
  marked unhealthy).
- **DATABASE_URL:** `${{Postgres.DATABASE_URL}}` (reference to the Postgres service —
  internal networking, same as the web service uses).

---

## Service 1 — `cron-realnex`

| Field | Value |
|---|---|
| Service name | `cron-realnex` |
| Source | `reedlabarcb/hoeck-team-dashboard` @ `main` |
| Start command | `npm run sync:realnex` |
| Cron schedule | `0 11 * * *`  (3 AM PT / 11:00 UTC) |

Env vars:
- `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
- `REALNEX_API_KEY` = (shared var)
- `REALNEX_SYNC_CONCURRENCY` = *(optional; code defaults to 5 — set only to override)*

---

## Service 2 — `cron-box-incremental`

| Field | Value |
|---|---|
| Service name | `cron-box-incremental` |
| Source | `reedlabarcb/hoeck-team-dashboard` @ `main` |
| Start command | `npm run sync:box:incremental` |
| Cron schedule | `0 12 * * *`  (4 AM PT / 12:00 UTC) |

Env vars:
- `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
- `BOX_CLIENT_ID` = (shared var)
- `BOX_CLIENT_SECRET` = (shared var)
- `BOX_TOKEN_ENCRYPTION_KEY` = (shared var)
- `BOX_TENANTS_CHAPMANHOECK_FOLDER_ID` = (shared var)

---

## Service 3 — `cron-box-full`

| Field | Value |
|---|---|
| Service name | `cron-box-full` |
| Source | `reedlabarcb/hoeck-team-dashboard` @ `main` |
| Start command | `npm run sync:box:full` |
| Cron schedule | `0 13 * * 0`  (5 AM PT Sunday / 13:00 UTC) |

Env vars: **same as `cron-box-incremental`**
- `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
- `BOX_CLIENT_ID`, `BOX_CLIENT_SECRET`, `BOX_TOKEN_ENCRYPTION_KEY`, `BOX_TENANTS_CHAPMANHOECK_FOLDER_ID` (shared vars)

---

## ⚠️ Open question to verify

**box-full run duration (~31 min).** Railway cron jobs run until the command exits, so a
31-min walk *should* be fine — but confirm your plan doesn't impose a shorter cron
execution cap. Verify the first `cron-box-full` run actually completes (service Deploy logs
+ `box_mirror` in `/api/health` flips to a fresh **full**-walk timestamp). If Railway kills
it early, we'll revisit (e.g. raise the limit or restructure).

---

## How to verify each cron works (the whole point)

Don't wait for the natural schedule — force a run: temporarily set the service's cron
schedule to ~2-3 min ahead, let it fire, then restore the real schedule. Confirm in
`/api/health`:

- **cron-realnex** → `realnex_mirror`: `sync_jobs` count +1, fresh `last sync` timestamp.
- **cron-box-*** → `box_mirror`: `completedWalks` +1, fresh `last successful walk`, flips
  **warn → ok**.

The clinching signal: the new DB row's `triggered_by` = **`cron`** (what was missing all
along). `box_mirror` / `realnex_mirror` staying `ok` on later days = the crons are firing.

---

## After all 3 are verified

Remove the dead `[[deploy.cronJobs]]` blocks from `railway.toml` (separate commit) so the
root toml is web-service-only and nothing misleads the next reader.
