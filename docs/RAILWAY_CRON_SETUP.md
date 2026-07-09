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

### 2. Set `cronSchedule` — via the GraphQL API (the dashboard is UNRELIABLE)
The dashboard's Cron Schedule field **did not persist** for these services (4+ attempts, *with*
the Apply/Deploy click — `railway status` kept showing the old/empty value). The CLI has no cron
command either. **Reliable method: Railway's GraphQL API** (proven 2026-07-09).

```
# token: the CLI's RAILWAY_API_TOKEN env var (or .railway/config.json). Header: Authorization: Bearer <token>
# endpoint: https://backboard.railway.app/graphql/v2
mutation($sid:String!,$eid:String!,$cron:String){
  serviceInstanceUpdate(serviceId:$sid, environmentId:$eid, input:{ cronSchedule:$cron })
}
# variables: sid=<service id>, eid=<production env id>, cron="0 11 * * *"  -> returns true
```
This sets `serviceInstance.cronSchedule`; the **scheduler picks it up immediately** — `railway
status` flips and shows the next run. Read it back with the same query (`serviceInstance{ cronSchedule }`).

**Then bake it into a deployment manifest** so the service is a proper cron (build-and-wait):
run **`railway up --service <svc> --detach`** — a FRESH deploy reads the current
`serviceInstance.cronSchedule` into the new manifest. Do **NOT** use `railway redeploy` — it
REPLAYS the old manifest and won't pick up the API-set schedule. (A manifest with no
`cronSchedule` = a normal service that runs the start command / a walk on deploy.)

**Source:** connect via `railway service source connect --repo reedlabarcb/hoeck-team-dashboard
--branch main --service <svc>` (or already connected). With the schedule set first, the fresh
deploy builds-and-waits (no run-on-deploy walk).

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
5. **Dashboard `cronSchedule` edits don't persist** for these services — even *with* the
   Apply/Deploy click (4+ attempts), `railway status` kept the old value. Set it via the API (step 2).
6. **PowerShell `railway variable set --stdin` prepends a BOM** — corrupts values; use direct args.
7. **`railway redeploy` REPLAYS the old manifest** — it won't pick up an API-set schedule.
   Use **`railway up`** (a fresh deploy) to bake `serviceInstance.cronSchedule` into a new manifest.
8. **A service with no `cronSchedule` in its manifest is a NORMAL service** → it runs the start
   command on deploy (a walk/sync + a web-healthcheck-timeout `Failed`). The manifest schedule
   (not just the scheduler-level one) is what makes it build-and-wait.

**Verification discipline:** a mis-registered cron fails silently — no error, it just never
runs. Always confirm a cron actually FIRED (a `triggered_by='cron'` row it produced); never
trust that it "looks" configured. The `realnex_mirror` / `box_mirror` freshness checks exist
for exactly this.
