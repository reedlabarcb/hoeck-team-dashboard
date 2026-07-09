# Railway cron services — SERVICE_ROLE dispatcher pattern (WORKING)

**Status: proven 2026-07-09.** `cron-realnex` fires via cron (manual Run-now *and* an
autonomous `0 0 UTC` scheduled run); `cron-box-incremental` fires via cron. This is the
FINAL working design, after several Railway config-precedence gotchas killed the simpler
approaches (dashboard start-command overrides, per-service config files). See "Gotchas"
below and `docs/LESSONS_LEARNED.md` "Railway cron".

## The design

Railway runs exactly ONE `cronSchedule` per service, and it executes that service's **start
command**. To run N different scheduled jobs from ONE repo, use **one Railway service per
job**, all sharing the same repo + root `railway.toml`, differentiated by a `SERVICE_ROLE`
environment variable:

- Root `railway.toml`: `startCommand = "sh scripts/start-dispatch.sh"`.
- `scripts/start-dispatch.sh` branches on `$SERVICE_ROLE`:
  - unset / `web` → `npm run db:migrate && npm run seed:users && npm start` (the web service — byte-for-byte the historical command)
  - `realnex` → `npm run sync:realnex`
  - `box-incremental` → `npm run sync:box:incremental`
  - `box-full` → `npm run sync:box:full`
- The **web service** sets no `SERVICE_ROLE`, so it runs the web command unchanged.
- Each **cron service** sets `SERVICE_ROLE=<role>` + its own `cronSchedule`.

Why a dispatcher instead of per-service start commands/config files? Because **config-as-code
overrides the dashboard** — while root `railway.toml` defines `startCommand`, a per-service
*dashboard* start command is ignored — and **per-service config-file paths didn't apply** in
practice. The dispatcher keeps ONE start command in code that every service shares and routes
on an env var (which the CLI *can* set). See Gotchas.

## The services

| Service | `SERVICE_ROLE` | `cronSchedule` | Role-specific env vars |
|---|---|---|---|
| `hoeck-team-dashboard` (web) | (unset) | (none) | its existing web vars |
| `cron-realnex` | `realnex` | `0 11 * * *` (3 AM PT) | `REALNEX_API_KEY` [+ optional `REALNEX_SYNC_CONCURRENCY`] |
| `cron-box-incremental` | `box-incremental` | `0 12 * * *` (4 AM PT) | `BOX_CLIENT_ID`, `BOX_CLIENT_SECRET`, `BOX_TOKEN_ENCRYPTION_KEY`, `BOX_TENANTS_CHAPMANHOECK_FOLDER_ID` |
| `cron-box-full` | `box-full` | `0 13 * * 0` (5 AM PT Sun) | same `BOX_*` as incremental |

Every cron service also needs `DATABASE_URL = ${{Postgres.DATABASE_URL}}` (reference) +
`SERVICE_ROLE`. All deploy from `reedlabarcb/hoeck-team-dashboard` @ `main` with the default
nixpacks build (the repo's `nixpacks.toml` runs `npm ci --include=dev`, so `tsx` is present).

## Setup per cron service

### 1. Create the service + set env vars — CLI
```
railway add --service <name>                                                    # empty service
railway variable set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' --service <name> --skip-deploys
railway variable set SERVICE_ROLE=<role>                        --service <name> --skip-deploys
# role secrets — pass the value via a shell variable, as a DIRECT ARG (see BOM gotcha):
railway variable set "REALNEX_API_KEY=$val"                     --service cron-realnex --skip-deploys
# (box services: the four BOX_* the same way)
```
⚠️ **Never `railway variable set KEY --stdin` from PowerShell** — it prepends a UTF-8 BOM
(U+FEFF) to the value. A BOM'd `BOX_TENANTS_CHAPMANHOECK_FOLDER_ID` made the Box root folder
"not accessible" and the walk failed instantly. Use `railway variable set "KEY=$value"`
(direct arg; value via a shell var so it's not printed). Verify: the stored value's first
char code must **not** be 65279.

### 2. Set `cronSchedule` + connect the source — DASHBOARD (CLI can't)
The CLI has **no** way to set `cronSchedule` (verified — no subcommand/flag). Dashboard only.
- Service → Settings → **Cron Schedule** = the value above.
- **Order: set the schedule BEFORE connecting the source.** A service with *no* cronSchedule
  is a normal service → it RUNS the start command on deploy (an unwanted walk/sync on connect,
  and the deploy then hangs `DEPLOYING` on the web healthcheck it can't answer). WITH a
  cronSchedule it's a cron → it builds and waits.
- Service → Settings → Source → connect `reedlabarcb/hoeck-team-dashboard` @ `main`.
- ⚠️ **Click the "Apply / Deploy staged changes" button.** Railway STAGES service-setting
  edits (schedule, source) behind an explicit apply. Unclicked = the change silently doesn't
  deploy. This is what made schedules "not take" and sources "stay disconnected" for us.
- ⚠️ **A schedule change needs a (re)deploy to take effect** — `cronSchedule` is baked into
  the deployment manifest; the running schedule doesn't change until a new deployment carries it.

### 3. Auto-deploy
Recommend **OFF** ("Deploy on push") per cron service, so a push to `main` doesn't rebuild all
4 services. Redeploy a cron service manually only when its code changes.

## Verify it actually fires (unauthenticated `/api/health`)
- `realnex_mirror`: `syncJobsCron` (count of `triggered_by='cron'` jobs) + `latestSyncTriggeredBy`.
- `box_mirror`: `walkJobsCron` + `latestJobTriggeredBy` + `latestJobStatus` (+ live folders/files
  while a walk runs, and `latestJobError` if one fails).

Test without waiting for the schedule: dashboard → service → **Run now** (Cron Runs). Confirm
the deploy logs show `sh scripts/start-dispatch.sh` → the correct `npm run sync:*` (NOT
`next start`), and a healthy `triggered_by=cron` row appears.

## Gotchas we hit (why the design is what it is)
1. **`[[deploy.cronJobs]]` arrays are silently ignored.** Railway supports only a single
   `deploy.cronSchedule` per service. The array form parses as inert config → never runs, no
   error. → one service per job.
2. **`cronSchedule` is manifest-baked.** Changing it needs a redeploy to take effect.
3. **Config-as-code overrides the dashboard.** Root `railway.toml` `startCommand` overrode
   per-service dashboard start commands → cron services ran the web server. → the dispatcher.
4. **Per-service Config-as-Code file paths didn't apply** (`railwayConfigFile` stayed empty;
   manifest kept the root start command). → abandoned config files for the dispatcher.
5. **Dashboard edits stage behind an explicit Apply/Deploy click** — unclicked = not applied.
6. **PowerShell `railway variable set --stdin` prepends a BOM** — corrupts values; use direct args.

**Verification discipline:** a mis-registered cron fails silently — no error, it just never
runs. Always confirm a cron actually FIRED (a `triggered_by='cron'` row it produced); never
trust that it "looks" configured. The `realnex_mirror` / `box_mirror` freshness checks exist
for exactly this.
