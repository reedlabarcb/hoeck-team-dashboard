# Hoeck Team Dashboard — Claude Code Build Spec v3

Paste this entire spec into a fresh Claude Code session in an empty project directory. Claude Code will scaffold the full project from this brief.

**v3 changes from v2:** Global backup export. React Query with focus refetch + polling. "Last updated" timestamps on every view. Git ritual baked into session start AND post-edit checks. System_state polling for background-job UI invalidation. Health check script as Phase 1 deliverable. Optimistic update rollback pattern explicit.

**Lessons-learned origins:** Every safeguard in this spec is in here because something broke on a prior project — inbound tracker storage races, Vercel filesystem wipes, SQLite-on-OneDrive corruption, golf BD git reverts, stale tab data Brandon never saw. The spec exists to make those failures impossible by construction, not to remember them.

---

## Project Overview

**Name:** `hoeck-team-dashboard`
**For:** Mike Hoeck, Jack Chapman, Nadya Gorelov (CBRE San Diego Tenant Rep team) — plus Reed LaBar as builder/admin
**GitHub:** `reedlabarcb/hoeck-team-dashboard` (private)
**Deploy:** Railway (Postgres + Next.js app)
**Stack:** Next.js 16 + TypeScript, Postgres on Railway, Drizzle ORM, Tailwind, shadcn/ui, **React Query** (for data freshness)

Tenant rep team dashboard integrating RealNex CRM + Box file storage + dashboard-native features (notes, tags, activity feed).

**Critical constraint: data integrity.** Three users edit simultaneously. The dashboard's writes are tightly scoped per-system with explicit allow-lists and enforcement in code.

---

## Source Documents

Paste into the repo before starting:
- `docs/RealNex_Workflow.md`
- `docs/Box_Workflow.md`

---

## Lessons Learned — Embedded in This Spec

Each safeguard below maps to a specific past failure. Do not weaken these — they are scar tissue.

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

## Safety Rules — Enforced in Code

### RealNex (read + create only)

**Allowed in `lib/external/realnex/safe.ts`:**
- Read: `listCompanies`, `getCompany`, `listContacts`, `getContact`, `listActivities`, `getActivity`, `listGroups`
- Create: `createCompany`, `createContact`, `createActivity`

**Forbidden — must not exist in the wrapper:**
- `update*`, `delete*`, `patch*`, `put*` against any RealNex entity
- Any HTTP PATCH/PUT/DELETE method

Tag every dashboard-created record with `Source: Dashboard`.

### Box (read + folder-create + file-upload + new-version + scoped folder rename)

**Allowed in `lib/external/box/safe.ts`:**
- Read: `listFolder`, `getFolder`, `getFile`, `getFileVersions`, `downloadFile`, `searchFolderTree`
- Create: `createFolder` (only inside `Tenants – ChapmanHoeck/Clients/*`), `uploadNewFile`, `uploadNewVersion`
- Scoped: `renameDealFolder(folderId, newName, oldName, reason)` — see scoped rename below

**Forbidden — must not exist:**
- `deleteFile`, `deleteFolder`, `moveFile`, `moveFolder`, `renameFile`
- Generic `renameFolder` (only `renameDealFolder` exists)
- Any overwrite-same-version operation

### Scoped Folder Rename

Only allowed: adding/modifying address on an existing deal folder.

```typescript
const DEAL_FOLDER_PATTERN = /^(\d{4}(?:[–-]\d{4})?)\s*[–-]\s*Lease\s+(Acquisition|Disposition)(\s*[–-]\s*.+)?$/;
```

`renameDealFolder` enforces:
1. Old name matches pattern
2. New name matches pattern
3. Year prefix unchanged
4. Deal type unchanged
5. Folder sits directly inside a client folder (or market subfolder for MT clients)
6. NOT a sublease shortcut

Confirmation modal: old name, new name, full path, client name, "destructive rename" warning. Activity feed entry with `status: 'destructive_rename'` flag.

### Master Excel — append-only in v1

- Read live on demand (no cache)
- `openpyxl` with `data_only=True`
- Appends only; existing rows never edited programmatically
- Formula columns: copy from row above with row-reference adjustment
- Every append: confirmation modal showing exact row
- Duplicate-client check before submit
- Upload as new version (Box keeps prior version)

### Enforcement

Pre-commit hook (`.husky/pre-commit`):

```bash
#!/bin/bash
FORBIDDEN="deleteFile|deleteFolder|moveFile|moveFolder|renameFile|updateCompany|updateContact|deleteCompany|deleteContact|updateActivity|deleteActivity|hardDelete|truncate"
VIOLATIONS=$(git diff --cached --name-only --diff-filter=ACM | grep -v "lib/external/" | grep -v ".test." | xargs grep -l -E "$FORBIDDEN" 2>/dev/null)
if [ -n "$VIOLATIONS" ]; then
  echo "ERROR: Forbidden destructive methods outside lib/external/:"
  echo "$VIOLATIONS"
  exit 1
fi
exit 0
```

Plus a vitest unit test in `lib/external/realnex/safe.test.ts` and `lib/external/box/safe.test.ts` that explicitly asserts forbidden methods are NOT exported:

```typescript
import * as realnexSafe from './safe';
test('forbidden methods are not exported', () => {
  const FORBIDDEN = ['updateCompany', 'updateContact', 'updateActivity', 'deleteCompany', 'deleteContact', 'deleteActivity'];
  for (const method of FORBIDDEN) {
    expect((realnexSafe as any)[method]).toBeUndefined();
  }
});
```

CI fails if either the lint hook or these tests fail.

---

## Data Freshness Architecture (new in v3)

This is the section that addresses the Golf BD "Brandon never saw Reed's changes" failure. Every view must stay fresh without manual refresh.

### React Query setup

All data fetching goes through `@tanstack/react-query`. Configured in `lib/query-client.ts`:

```typescript
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Refetch when window/tab regains focus — catches the "switched tabs" case
      refetchOnWindowFocus: true,
      // Refetch when network reconnects
      refetchOnReconnect: true,
      // Don't refetch on every mount — let staleTime control it
      refetchOnMount: 'always',
      // Stale time: data considered fresh for 30s, then refetched on next access
      staleTime: 30_000,
      // Retry once on transient failures
      retry: 1,
    },
  },
});
```

### Polling strategy per data type

| Data | Polling interval | Why |
|---|---|---|
| `activity_feed` (home page recent activity) | 30s | Highest-visibility shared view |
| `companies_mirror`, `contacts_mirror` lists | 60s | Updated by nightly sync + dashboard creates |
| `system_state.last_sync_at` (lightweight) | 30s | Detects background-job completion |
| Master Excel lookups | No polling (on-demand only) | Reads live from Box each time |
| Notes/tags on a record | 45s when record is open | Catches another user's edits in real-time-ish |
| Box folder index | No polling | Indexed nightly; manual refresh button available |

### "Updates available" badge

A lightweight endpoint `/api/system/last-write` returns:

```json
{
  "last_write_at": "2026-05-19T14:32:08Z",
  "last_sync_at": "2026-05-19T04:00:00Z",
  "tables": {
    "notes": "2026-05-19T14:32:08Z",
    "companies_mirror": "2026-05-19T04:00:00Z",
    "contacts_mirror": "2026-05-19T04:00:00Z",
    "activity_feed": "2026-05-19T14:31:42Z"
  }
}
```

Frontend polls every 30s. Each view tracks its own `data_fetched_at`. If `tables[relevant_table] > data_fetched_at`, show an amber "New changes available — click to refresh" badge near the "Updated HH:MM:SS" timestamp. Click invalidates the React Query cache for that view, forcing a refetch.

### "Last updated" timestamp pattern

Every page/major widget has a small grey timestamp in the top-right:

```
Updated 14:32:08  [refresh icon]
```

Click forces immediate refetch. This is a `<LastUpdated />` component in `components/LastUpdated.tsx` that takes a React Query `query` object and renders the timestamp + click handler.

### Optimistic updates with rollback

For dashboard-native edits (notes, tags), use React Query's optimistic update pattern with rollback on server error:

```typescript
const mutation = useMutation({
  mutationFn: updateNote,
  onMutate: async (newNote) => {
    await queryClient.cancelQueries({ queryKey: ['notes', newNote.id] });
    const previousNote = queryClient.getQueryData(['notes', newNote.id]);
    queryClient.setQueryData(['notes', newNote.id], newNote);
    return { previousNote };
  },
  onError: (err, newNote, context) => {
    // Roll back on error
    queryClient.setQueryData(['notes', newNote.id], context.previousNote);
    toast.error('Failed to save. Your changes were rolled back.');
  },
  onSettled: (data, error, variables) => {
    // Always refetch to ensure server state
    queryClient.invalidateQueries({ queryKey: ['notes', variables.id] });
  },
});
```

**Critical:** For 409 Conflict responses (optimistic lock failure), don't just roll back — show the conflict UI from the flow chart in our earlier discussion: "Jack edited this 30 seconds ago. Here are your changes side-by-side with Jack's."

---

## Background Job → UI Notification

When the nightly sync runs (RealNex + Box), it updates a `system_state` table:

```sql
CREATE TABLE system_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rows:
-- ('last_sync_realnex', '{"timestamp": "...", "result": "success", "counts": {...}}')
-- ('last_sync_box', '{"timestamp": "...", "result": "success", "indexed": 2847}')
-- ('last_master_excel_modified', '{"box_modified_at": "...", "version": 47}')
```

The `/api/system/last-write` endpoint exposes these. Frontend uses them to:
1. Detect a sync completed → invalidate `companies_mirror`/`contacts_mirror` queries
2. Show a small toast: "Synced from RealNex (12 new contacts)"
3. Update the home page's "Last Sync" widget

---

## Global Backup Export (new in v3)

Endpoint `/api/export/all` produces a ZIP file containing:

- `notes.json` — all dashboard notes
- `tags.json` — all tags
- `activity_feed.json` — last 90 days of activity (full history is in DB)
- `companies_mirror.xlsx` — current RealNex companies snapshot
- `contacts_mirror.xlsx` — current RealNex contacts snapshot
- `activities_mirror.xlsx` — RealNex activities snapshot
- `box_folder_index.xlsx` — folder tree snapshot
- `metadata.json` — export timestamp, app version, schema version

UI: a "Download Backup" button in the dashboard header (next to the user menu). Clicking shows a brief "Preparing backup..." spinner, then downloads `hoeck-dashboard-backup-2026-05-19_143208.zip`.

**Important:** This is for user peace of mind, not as the primary rollback mechanism. RealNex and Box are still the systems of record. The backup is a snapshot of *our* state at a moment in time.

---

## RealNex Workflows (unchanged from v2)

[Workflows 1–4 as in v2. Key details preserved:]
- Workflow 1: Web search for company website, auto-prompt missing optional fields
- Workflow 2: Conditional checkbox cascade from Company, Group dropdown from live RealNex, chain to Workflow 1 if Company missing
- Workflow 3: Both structured form AND conversational parser, chain to Workflows 1+2 if needed
- Workflow 4: Filter + Excel export with fixed column order

---

## Box Workflows (unchanged from v2)

[Folder index with convention parsing, latest-lease content-aware detection, proposal numbering sanity check, Master Excel lookup + append, scoped folder rename. All as in v2.]

---

## Database Schema (v3 additions)

### New table: `system_state`

```sql
CREATE TABLE system_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Updated: all editable tables include

```sql
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
version INTEGER NOT NULL DEFAULT 1,
deleted_at TIMESTAMPTZ,
created_by TEXT NOT NULL,
updated_by TEXT NOT NULL
```

A Postgres trigger on every editable table auto-updates `updated_at` and increments `version` on UPDATE:

```sql
CREATE OR REPLACE FUNCTION update_version_and_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.version = OLD.version + 1;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER notes_version_trigger
  BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION update_version_and_timestamp();
-- (Repeat for tags, and any future editable table)
```

This means the application code can't accidentally forget to bump version. It happens at the DB level.

---

## Phase 1 Deliverable: Health Check Script (new in v3)

Before Phase 2 starts, Claude Code must build `scripts/health-check.ts`:

```typescript
// scripts/health-check.ts
// Run with: npm run health
// Verifies every external dependency is reachable and configured correctly.

async function main() {
  const checks = [];

  // 1. Postgres connectivity
  checks.push(await checkPostgres());
  // 2. RealNex API reachable + auth valid
  checks.push(await checkRealNex());
  // 3. Box API reachable + auth valid
  checks.push(await checkBox());
  // 4. Box: can we see Tenants – ChapmanHoeck folder?
  checks.push(await checkBoxRootFolder());
  // 5. Box: can we see Master Excel file?
  checks.push(await checkMasterExcelFile());
  // 6. Anthropic API key valid (light call)
  checks.push(await checkAnthropic());
  // 7. Python + openpyxl available
  checks.push(await checkPythonBridge());
  // 8. All required env vars set
  checks.push(await checkEnvVars());

  // Report
  console.table(checks);
  const failures = checks.filter(c => c.status !== 'ok');
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll systems operational.');
}
```

This is the diagnostic anyone on the team can run when something feels broken: `npm run health`. Shows table of pass/fail per dependency, exits non-zero if anything fails.

Also expose as `/api/health` endpoint for Railway's healthcheck and for in-app display on a `/settings/system-status` page.

---

## File Structure (v3)

```
hoeck-team-dashboard/
├── app/
│   ├── (auth)/login/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx                          # sidebar + auth guard + LastUpdated context
│   │   ├── page.tsx                            # home: activity feed + upcoming + system status
│   │   ├── companies/                          # 4 RealNex workflows
│   │   ├── contacts/
│   │   ├── activities/
│   │   ├── files/                              # Box folder browser + rename
│   │   ├── master-excel/
│   │   ├── activity-feed/page.tsx
│   │   └── settings/
│   │       ├── system-status/page.tsx          # health check UI
│   │       └── backup/page.tsx                 # download backup
│   └── api/
│       ├── auth/, realnex/, box/, master-excel/, notes/, tags/, activity-feed/
│       ├── system/
│       │   ├── last-write/route.ts             # for polling
│       │   └── health/route.ts                 # for /api/health
│       └── export/
│           └── all/route.ts                    # full backup zip
├── lib/
│   ├── db/schema/, db/index.ts, db/migrate.ts, db/triggers.sql
│   ├── external/
│   │   ├── realnex/{client,safe,sync,types}.ts + safe.test.ts
│   │   └── box/{client,safe,folder-walker,master-excel,types}.ts + safe.test.ts
│   ├── auth/{session,middleware,seed}.ts
│   ├── parsers/{conversational-activity,lease-pdf,folder-name}.ts
│   ├── activity.ts
│   ├── query-client.ts                         # React Query config
│   └── utils.ts
├── components/
│   ├── ui/                                     # shadcn/ui
│   ├── LastUpdated.tsx                         # timestamp + refresh
│   ├── UpdatesAvailableBadge.tsx
│   ├── OptimisticLockWarning.tsx
│   ├── ActivityFeed.tsx
│   ├── ConfirmationModal.tsx
│   └── ...
├── scripts/
│   ├── python/{master_excel_read,master_excel_append,tests}/
│   ├── health-check.ts
│   ├── seed-users.ts
│   ├── sync-cron.ts
│   └── backup-export.ts
├── docs/
│   ├── RealNex_Workflow.md
│   ├── Box_Workflow.md
│   └── LESSONS_LEARNED.md                      # the table at top of this spec, in repo
├── .husky/pre-commit
├── MEMORY.md
├── AGENTS.md
├── README.md
├── railway.toml
├── drizzle.config.ts
├── package.json
├── tsconfig.json
└── .env.local.example
```

---

## Build Order (v3, 8 phases)

### Phase 1: Foundation + Health Check
- Scaffold Next.js 16 + TS + Tailwind + shadcn/ui
- Drizzle + Postgres + migrations + version trigger
- Auth (login + middleware + seed users)
- React Query setup
- Activity feed table + `logActivity` helper
- **`system_state` table + `/api/system/last-write` endpoint**
- **`scripts/health-check.ts` + `/api/health` endpoint**
- **`<LastUpdated />` and `<UpdatesAvailableBadge />` components**
- Dashboard layout shell
- `MEMORY.md` initialized
- All safe wrapper stubs (`lib/external/*/safe.ts`) with TODO comments listing allowed methods
- `safe.test.ts` files asserting forbidden methods don't exist
- Git pre-commit hook installed

**Phase 1 acceptance test:** `npm run health` passes locally and on Railway.

### Phase 2: Box Folder Index
- Box safe wrapper (read methods)
- Folder walker with convention parsing
- `box_folder_index` table
- `/files` page with React Query, polling on demand only (no automatic poll — too much data)
- Manual "Refresh from Box" button → triggers re-index
- Search with convention filters
- File click → live Box URL

### Phase 3: RealNex Sync + 4 Workflows
- RealNex safe wrapper
- Nightly sync (companies, contacts, activities, groups)
- `system_state.last_sync_realnex` updated by sync job
- `/companies` and `/contacts` lists with React Query (60s polling)
- Workflow 1 (with web search for website)
- Workflow 2 (with conditional checkbox cascade + Group dropdown + chain workflows)
- Workflow 3 structured + conversational (with chain workflows)
- Workflow 4 (filter + Excel export)
- Optimistic updates with rollback for any inline edits

### Phase 4: Master Excel Reads
- Python bridge scripts
- Live lookup endpoint (no polling)
- `/master-excel` lookup UI with `<LastUpdated />` showing Box file modified date
- Cross-check button → opens lease PDF in Box

### Phase 5: Master Excel Appends + Lease Filing
- PDF parser via Anthropic API
- Multi-gate confirmation flow
- Python append with formula preservation
- Box new-version upload
- Coupled lease PDF filing
- Two-entry activity feed log

### Phase 6: Box Folder Rename
- `renameDealFolder` in safe wrapper
- `/files/[folderId]/rename` UI with pattern validation
- Confirmation modal with destructive warning
- Re-indexer for renamed subtree
- Prominent activity feed entry

### Phase 7: Notes / Tags / Optimistic Locking
- Notes table + CRUD API with 409 Conflict handling
- Tags table + CRUD
- Attachment to companies/contacts/deals
- UI with optimistic updates + rollback + conflict resolution UI
- 45s polling on open record

### Phase 8: Dashboard Home + Backup + Health UI
- Recent activity feed (30s polling)
- Upcoming expirations widget
- Folder Health widget (non-matching folders count)
- Quick-add CTAs
- `/settings/backup` page with "Download Backup" button → `/api/export/all`
- `/settings/system-status` page with live health check display

### Deferred to v2.x (per Nadya)
- New Client Workflow (folder templates copy)
- Edit existing Master Excel rows
- Lease clause parsing for date verification

---

## MEMORY.md Template (v3)

```markdown
# Hoeck Team Dashboard — MEMORY

## Project Overview
Tenant rep dashboard for Mike Hoeck, Jack Chapman, Nadya Gorelov.
Stack: Next.js 16 + TS, Postgres on Railway, Drizzle, Tailwind + shadcn/ui, React Query.
RealNex (read + create only), Box (read + folder-create + file-upload + scoped rename).
Master Excel: append-only in v1.

## Critical Safety Rules (NEVER VIOLATE)
- NEVER add update/delete methods to lib/external/realnex/safe.ts
- NEVER add delete/move methods to lib/external/box/safe.ts
- ONLY rename allowed is renameDealFolder with DEAL_FOLDER_PATTERN check
- NEVER allow renameFile under any circumstance
- Master Excel: append-only, never overwrite existing rows
- All Box file writes upload as NEW VERSION
- All dashboard tables: soft delete only (deleted_at)
- All updates: optimistic locking (version column, auto-incremented by trigger)
- Forbidden methods are absent from safe wrappers AND covered by unit tests

## Lessons Learned (do not re-violate)
- SQLite on synced folders corrupts under concurrent edits → Postgres on Railway
- Hardcoded DB paths break silently → DATABASE_URL env var only
- Tab data goes stale without React Query → use refetch-on-focus + polling
- Background jobs need UI invalidation → system_state polling
- Git reverts wipe work → session start ritual checks git log
- Users feared losing data → /api/export/all backup endpoint
- No "is this fresh?" indicator → <LastUpdated /> on every view

## Current Status
- [ ] Phase 1: Foundation + health check
- [ ] Phase 2: Box folder index
- [ ] Phase 3: RealNex sync + 4 workflows
- [ ] Phase 4: Master Excel reads
- [ ] Phase 5: Master Excel appends
- [ ] Phase 6: Box folder rename
- [ ] Phase 7: Notes/tags/locking
- [ ] Phase 8: Home + backup + health UI

## Schema
[Tables and key columns — update when schema changes]

## API Keys / Env Vars
- DATABASE_URL
- REALNEX_API_KEY, REALNEX_API_BASE_URL
- BOX_CLIENT_ID, BOX_CLIENT_SECRET, BOX_ACCESS_TOKEN
- BOX_TENANTS_CHAPMANHOECK_FOLDER_ID
- BOX_MASTER_EXCEL_FILE_ID
- ANTHROPIC_API_KEY
- SESSION_PASSWORD
- NODE_ENV

## Recent Changes
[Last 5 changes with date]

## Known Issues / Bugs
[Track here]

## Next Up
1. [Top]
2. [Second]
3. [Third]

## Key Decisions
- Postgres not SQLite
- React Query with 30s staleTime, refetch-on-focus
- No Master Excel cache (live reads, infrequent)
- Append-only Master Excel v1
- Activity feed = UI surface; RealNex + Box are real history
- Password auth (no SSO)
- Python bridge for openpyxl
- Folder rename only for adding address to deal folders
- Conversational parser via Anthropic API
- Backup export = peace of mind, not primary rollback

## Railway Deployment
- Postgres add-on (managed)
- Daily cron 4 AM Pacific (12:00 UTC) runs `npm run sync:all`
- Env vars in Railway dashboard
- Healthcheck path: /api/health

## Session Start Ritual (MANDATORY)
1. `git status` — any uncommitted changes?
2. `git log --oneline -10` — where are we?
3. `git stash list` — anything stashed?
4. Read MEMORY.md fully
5. Summarize current status to user
6. Confirm goal for this session before touching code

## Session End Ritual (MANDATORY)
1. Update Current Status, Recent Changes, Known Issues, Next Up
2. `git diff` review of all changes
3. Commit with clear message
4. Push to GitHub
5. Confirm push succeeded before ending
```

---

## AGENTS.md (v3)

```markdown
# Claude Code Session Rules — Hoeck Team Dashboard v3

## Session Start (MANDATORY, no exceptions)
1. Run `git status` and report output
2. Run `git log --oneline -10` and report output
3. Run `git stash list` and report output
4. Read MEMORY.md fully
5. Read docs/LESSONS_LEARNED.md
6. Read docs/RealNex_Workflow.md and docs/Box_Workflow.md if touching integrations
7. Summarize: current phase, last commit, what's planned today
8. Ask user to confirm before writing any code

If git history shows unexpected state (uncommitted changes, recent reverts, stashed work), STOP and ask the user before proceeding.

## Post-Edit Check (MANDATORY after every file change)
1. Run `git diff <file>` immediately after editing
2. Verify only intended lines changed
3. If unexpected changes appear, undo and ask the user
4. Run any relevant tests for that file

## Hard Rules
- NEVER add methods to lib/external/realnex/safe.ts beyond the allow-list
- NEVER add methods to lib/external/box/safe.ts beyond the allow-list
- ONLY rename allowed is `renameDealFolder` with DEAL_FOLDER_PATTERN
- NEVER call DELETE on any application table (soft delete only)
- NEVER overwrite Master Excel — always uploadNewVersion
- NEVER edit existing Master Excel rows in v1
- NEVER commit secrets — use .env.local
- NEVER skip the session-start git ritual

## Workflow-Specific Rules
- Workflow 2 Contact: Occupier and Prospect checkboxes are AUTO-DERIVED from Company. Render read-only.
- Workflow 2: Group dropdown MUST come from `groups_mirror` or live `realnex.listGroups()`. Never free-text.
- Workflow 3 conversational: Confidence indicators required. Low confidence requires per-field confirmation.
- Workflow 4 export: column order FIXED — Company, Contact, Title, Email, Lease Expiration, Space Size, Group.
- Master Excel append: copy formulas from row above, adjust row references, never write static values to formula cells.
- Folder rename: client-side AND server-side validation. Year and deal type unchangeable.

## React Query Rules
- Every list/detail view uses React Query, not bare fetch
- Every view component renders `<LastUpdated query={...} />`
- Mutations use optimistic updates with onError rollback
- 409 Conflict responses trigger the conflict-resolution UI, not just rollback

## Next.js 16 Notes
- App Router only
- Server actions for form submissions where appropriate
- Route handlers in app/api/*/route.ts

## Testing
- pytest for Python scripts (formula copy, fuzzy match, date parsing)
- vitest for TypeScript
- REQUIRED tests: `safe.test.ts` for each external wrapper, asserting forbidden methods are absent
- Test the optimistic-lock 409 path explicitly

## Session End (MANDATORY)
1. Update MEMORY.md (Current Status, Recent Changes, Known Issues, Next Up)
2. `git diff` review
3. Commit with clear message
4. `git push`
5. Confirm push succeeded
6. Report to user: what was built, what's next, any open questions
```

---

## .env.local.example

```
DATABASE_URL=postgresql://user:pass@host:port/dbname

REALNEX_API_KEY=
REALNEX_API_BASE_URL=

BOX_CLIENT_ID=
BOX_CLIENT_SECRET=
BOX_ACCESS_TOKEN=
BOX_TENANTS_CHAPMANHOECK_FOLDER_ID=
BOX_MASTER_EXCEL_FILE_ID=

ANTHROPIC_API_KEY=

SESSION_PASSWORD=replace-with-32-char-random-string

NODE_ENV=development
```

---

## railway.toml

```toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "npm run db:migrate && npm start"
healthcheckPath = "/api/health"
restartPolicyType = "on_failure"

[[deploy.cronJobs]]
schedule = "0 12 * * *"  # 4 AM Pacific = 12:00 UTC
command = "npm run sync:all"
```

Add this to `nixpacks.toml` to ensure Python + openpyxl in the Railway build:

```toml
[phases.setup]
nixPkgs = ['nodejs_20', 'python311', 'python311Packages.pip']

[phases.install]
cmds = ['npm ci', 'pip install -r requirements.txt']
```

`requirements.txt`:
```
openpyxl==3.1.2
```

---

## package.json scripts

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",
    "seed:users": "tsx scripts/seed-users.ts",
    "sync:realnex": "tsx scripts/sync-cron.ts realnex",
    "sync:box": "tsx scripts/sync-cron.ts box",
    "sync:all": "tsx scripts/sync-cron.ts all",
    "backup": "tsx scripts/backup-export.ts",
    "health": "tsx scripts/health-check.ts",
    "test": "vitest",
    "test:python": "pytest scripts/python/tests/",
    "lint": "next lint",
    "prepare": "husky install"
  }
}
```

---

## Build Instructions for Claude Code

1. Read this entire spec.
2. Read MEMORY.md (will be empty initially — create it from the v3 template).
3. Read docs/LESSONS_LEARNED.md (will be empty initially — create from the table at the top of this spec).
4. Confirm understanding by listing back:
   - The four RealNex workflows
   - The Box safe-wrapper allow-list
   - The folder-rename constraints
   - The session-start git ritual
   - The lessons-learned list
   - The Phase 1 deliverables (including `health-check.ts`)
5. Begin Phase 1. Phase 1 completion requires `npm run health` to pass.
6. After each phase: update MEMORY.md, commit, push, ask user before continuing.
7. Build sequentially. No skipping ahead.
8. If anything is ambiguous, ask Reed before assuming.

Start by setting up the Next.js project, installing dependencies (including React Query, husky), creating MEMORY.md, AGENTS.md, and docs/LESSONS_LEARNED.md, and writing the empty `lib/external/realnex/safe.ts` and `lib/external/box/safe.ts` stub files with TODO comments listing every allowed method and `safe.test.ts` files asserting forbidden methods don't exist.
