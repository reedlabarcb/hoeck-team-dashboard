# Phase 3 — RealNex CRM Integration: Build Plan

**Status:** P3.1–P3.6 BUILT & DEPLOYED (2026-07-13). Read-only mirror + read UIs (P3.5) live; LXD/SF `details` walk added (Option A, migration 0009); note-logging (P3.6 wrapper `appendActivity` + P3.9 Log Note UI/route) built + safety-proven — but the single live test write was **deferred by choice** (Reed opted not to write to the production CRM for a verification-only append; the path is fully built + unit-tested, unexercised-on-prod). Remaining: P3.7 create-company, P3.8 create-contact, P3.11 Workflow 4 export; P3.10 deferred. (Original: PLAN FOR REVIEW — no implementation code until Reed approves the phase breakdown.)
**Author basis:** `docs/RealNex_API_Discovery.md`, `docs/RealNex_Workflow.md` (Nadya), BUILD_SPEC v3 (Safety Rules + RealNex Workflows + Build Order), MEMORY.md (RealNex Discovery + Key Decisions).
**Repo state at planning:** `main` @ `9e1b95f`, clean tree.

Phase 3 is the **largest and most safety-sensitive phase** — it writes to a production CRM
under Mike Hoeck's account. The plan front-loads **read-only** work (sync + mirror + read UIs
with *zero* write capability), and only introduces create methods later, behind the safety
enforcement in the section below. Conversational AI (the riskiest, and a spec contradiction)
comes near the end and is gated on a decision.

Same delivery pattern as Phase 4 / 2.5a: **numbered commits, each with a review gate, tested
before push, pre-commit must pass, never commit on red.**

---

## Scope decision (2026-07-07): note-logging is the headline write feature

Reed's core use of the dashboard is **logging a history note onto a contact or company**
(e.g. "had lunch with Maria, her daughter's going to Berkeley"). How it's built:

- **LOCAL-FIRST STRUCTURED ENTRY - no LLM, no external text exposure.** Flow:
  1. **Local autocomplete** resolves the contact/company against the synced mirror - instant, no
     network. This is the **highest-consequence step**: resolving the right person locally prevents
     logging a note to the WRONG contact.
  2. **Event-type pick** (Note / Meeting / Call / Email).
  3. **Verbatim note body** (typed as-is; never sent anywhere external).
  4. **Confirm-before-write, every time.**
  Works for both **contacts AND companies**. Fits Reed's actual usage (mostly one-contact-one-note),
  sidesteps the Anthropic/DLP question entirely, and never guesses who the contact is.
- **This is a WRITE to RealNex** - a CREATE of a History/Activity **appended to an existing** record
  (`appendActivity` -> `POST /api/v1/Crm/object/{key}/history`). It is the **ALLOWED append** (create
  of a child object), **NOT an edit** of the parent - consistent with the write-safety model below.
  Reconfirm this when P3.6 adds the create methods.
- **PRIORITY: the create-History path (P3.6 create methods + P3.9 log-note form) is the #1 write
  feature** - "the whole point of the dashboard" per Reed. **P3.5 read UIs are secondary** (useful for
  browsing + as the autocomplete source), but note-logging is the headline. Sequencing may bring the
  P3.6/P3.9 write path forward relative to the strict top-to-bottom order below - to be planned after
  the first cron run is verified.
- **Autocomplete source = the local mirror** (already synced by P3.4), so **P3.5's contact/company
  data feeds the note-logging autocomplete** - a dependency to keep when sequencing.
- **P3.10 conversational LLM parser stays DEFERRED** - not needed for Reed's single-note-at-a-time
  usage (not multi-entity brain-dumps). No `ANTHROPIC_API_KEY`, no external-text exposure. MEMORY's
  "Anthropic dropped" decision remains authoritative. Revisit only if multi-entity freeform logging
  becomes a real need.

---

## RealNex Write Safety — Enforced in Code

**This is the non-negotiable core of Phase 3. Read it before touching any RealNex code.**

### The exact write policy

**ALLOWED:**
1. **Create a new Company** — `POST /api/v1/Crm/company`.
2. **Create a new Contact** — `POST /api/v1/Crm/contact`.
3. **Append a new History/Activity to an EXISTING Company or Contact** —
   `POST /api/v1/Crm/object/{objectKey}/history`.

**FORBIDDEN — permanently, not just v1:**
- **Modifying ANY field on an existing Company or Contact** — no `PUT`, no `PATCH`
  (e.g. `PutEditCompanyAsync`, `PutEditContactAsync`, `PutCompanyNotesAsync`,
  `PutCompanyDetailsAsync`, all `/personal|/agent|/investor|/tenant|/vendor` PUTs).
- **Deleting ANYTHING** — no `DELETE` (`DeleteCompanyAsync`, `DeleteContactAsync`,
  `DeleteHistoryAsync`, `DeleteObjectGroupAsync`, `DeleteObjectGroupMemberAsync`, etc.).

### ⚠️ The one nuance that must not be conflated

**Appending a History/Activity to an existing record is ALLOWED and is NOT an edit.**

- It creates a **new child Activity object** linked to the parent — the parent Company/Contact
  record's own fields are **never touched**. Nadya's Workflow 3 *requires* this.
- A future maintainer must not (a) **wrongly block** it thinking "writing under an existing
  record = editing it" — it isn't; nor (b) **wrongly generalize** from it to "we allow writes
  to existing records, so PUT/PATCH on company/contact fields is fine" — it is **not**.
- The distinction in one line: **we may CREATE objects (companies, contacts, activities); we
  may never MUTATE or DELETE an existing company/contact (or any) object's fields.**
- `POST .../object/{objectKey}/history` is a **create** (new History row), even though the URL
  contains an existing object's key. The key identifies the *parent to attach to*, not a record
  to edit.

### Three enforcement layers (policy in prose is not enough)

**1. Wrapper surface — capability simply doesn't exist.**
`lib/external/realnex/safe.ts` exposes ONLY these methods, and imports/wraps **no** mutating
RealNex endpoint at all:

| Allowed method | Maps to | Kind |
|---|---|---|
| `getClientInfo` | `GET /api/Client` | read |
| `listGroups` | `GET /api/v1/Crm/group` | read |
| `listEventTypes` / `listHistoryStatuses` / `listUsers` / … | `GET /api/v1/Crm/<lookup>` | read |
| `getCompany` | `GET /api/v1/Crm/company/{key}/full` | read |
| `getContact` | `GET /api/v1/Crm/contact/{key}/full` | read |
| `searchContacts` | `GET /api/v1/Crm/contact/autocomplete` | read |
| `listCompanies` / `listContacts` | OData (see P3.2) | read |
| `getObjectHistory` | `GET /api/v1/Crm/object/{key}/history` | read |
| `createCompany` | `POST /api/v1/Crm/company` | create |
| `createContact` | `POST /api/v1/Crm/contact` | create |
| `appendActivity` | `POST /api/v1/Crm/object/{key}/history` | create (child append) |

The wrapper file header MUST document the endpoints **deliberately NOT wrapped and why** —
explicitly listing every `PUT`/`PATCH`/`DELETE` operationId from discovery (PutEditCompany,
PutEditContact, PutCompanyNotes, PutCompanyDetails, all contact-subresource PUTs,
DeleteCompany, DeleteContact, DeleteHistory, DeleteObjectGroup, DeleteObjectGroupMember,
DeleteContactAddress, DeleteHistoryObjects) so it's unmistakable they were omitted on purpose,
not by oversight. **Read methods only until P3.6; create methods are added then, never edit/delete.**

> Naming choice: the activity-append method is named **`appendActivity`** (not `createActivity`)
> to make its semantics self-documenting at call sites and to keep the forbidden-grep simple.
> (BUILD_SPEC's allow-list said `createActivity`; we reconcile to `appendActivity` — same
> create-only semantics, clearer name. Noted as a deliberate deviation.)

**2. Pre-commit grep — extends the existing `.husky/pre-commit`.**
Add RealNex-specific forbidden patterns to the existing `FORBIDDEN` alternation (which already
covers Box + Master Excel), applied outside `lib/external/` and test files:
- method-name patterns: `updateCompany|updateContact|editCompany|editContact|deleteCompany|deleteContact|updateActivity|deleteActivity|putCompany|putContact|patchCompany|patchContact`
- a RealNex HTTP-verb guard: flag string literals combining a mutating verb with a realnex path,
  e.g. `method:\s*['"](PUT|PATCH|DELETE)['"]` in any file that also references `realnex` /
  `sync.realnex.com` (outside the wrapper). (Implementation detail finalized in P3.1; the intent
  is "no PUT/PATCH/DELETE to RealNex anywhere but — and even there, not — the wrapper.")

**3. vitest surface assertion — `lib/external/realnex/safe.test.ts`.**
Imports the wrapper and asserts:
- the exported surface is EXACTLY the allowlist (set equality — fails if a method is **added**,
  not just if a forbidden one appears), and
- an explicit forbidden-list (`updateCompany`, `putCompany`, `patchCompany`, `deleteCompany`,
  `updateContact`, `deleteContact`, `editContact`, `updateActivity`, `deleteActivity`,
  `deleteHistory`, `deleteGroup`, …) is each `toBeUndefined()`.

CI/commit fails if any layer fails. This test ships in **P3.1** (read-only surface) and is
updated in **P3.6** to add exactly `createCompany`/`createContact`/`appendActivity` — any other
addition fails the set-equality check.

---

## Discovery findings that change the original BUILD_SPEC plan

| BUILD_SPEC v3 assumption | What discovery found | Plan response |
|---|---|---|
| `listCompanies` is a simple read | **No company-list/search endpoint** outside OData | P3.2 OData spike proves enumeration before the mirror is built; `listCompanies`/`listContacts` go through OData |
| `listActivities` (flat feed) | History is **object-scoped**; no global activity feed | `getObjectHistory(objectKey)`; "recent activity" view (if wanted) is built from the mirror, not a live call |
| `createActivity` | Object-scoped `POST .../object/{key}/history` (child append) | `appendActivity(objectKey, …)`; resolve the parent object key first |
| Conversational Workflow 3 via Anthropic | **MEMORY Key Decisions: "Anthropic dropped 2026-05-21 — structured form only for Workflow 3"** | ⚠️ **CONTRADICTION — must be resolved before P3.10** (see Open Questions) |
| Generic auth | JWT is **Mike Hoeck's personal token**; all writes attributed to Mike | Single-identity in v1; `REALNEX_API_KEY` must be set in Railway (currently local-only); multi-user deferred |

---

## Architecture (confirmed from BUILD_SPEC, reconciled with discovery)

- **Nightly RealNex → Postgres mirror.** Dashboard **reads from the mirror** (fast, no live API
  per page). Enumeration via OData (P3.2).
- **Writes are create-only and go LIVE to RealNex**, then we **re-sync that one record** into the
  mirror so the UI reflects it without waiting for the nightly job.
- **Activity feed** (`logActivity`) records every dashboard action (every create especially).
- **Optimistic locking** applies ONLY to dashboard-native data (notes/tags, a later phase) — NOT
  to the RealNex mirror. **RealNex is the source of truth for mirrored records**; the mirror has
  no `version` column and is overwritten by sync (UPSERT by RealNex key).
- **Async-job pattern reused from Phase 2** (`box_sync_jobs` + `job-runner` + instrumentation
  orphan recovery): a `realnex_sync_jobs` equivalent drives the nightly + manual sync.

---

## Phase breakdown (numbered commits + review gates)

Dependency order is strict top-to-bottom. **No write capability exists in the codebase until P3.6.**

### P3.1 — Safe wrapper (READ-ONLY) + auth client + safety enforcement + health probe
- **Builds:** `lib/external/realnex/client.ts` (Bearer-JWT fetch wrapper, base `sync.realnex.com`,
  `REALNEX_API_KEY`, error/retry handling), `types.ts`, `safe.ts` with **read methods only**
  (`getClientInfo`, lookup-table reads, `getCompany`, `getContact`, `searchContacts`,
  `getObjectHistory`, `listGroups`). Header doc of deliberately-unwrapped mutating endpoints.
  Extend `.husky/pre-commit` with RealNex forbidden patterns. `safe.test.ts` set-equality +
  forbidden assertions. Add `realnex` live check to `/api/health` (`GET /api/Client`).
- **Review gate:** wrapper surface = read-only allowlist; a deliberately-planted `updateCompany`
  fails the pre-commit + test (demonstrated); `/api/health` `realnex=ok` on prod; `REALNEX_API_KEY`
  set in Railway.
- **Tests:** `safe.test.ts` (surface), client unit (auth header, base URL, error mapping), health probe.

### P3.2 — OData enumeration spike (READ-ONLY) — *resolves the biggest uncertainty*
- **Builds:** read-only probes of the `CrmOData` endpoints to confirm we can **page the full set**
  of companies + contacts (and filter by lease expiration / SF / group for Workflow 4). Document
  the exact OData query shapes in `docs/RealNex_API_Discovery.md`. Add `listCompanies`/`listContacts`
  (read) to the wrapper via OData.
- **Review gate:** confirmed we can enumerate all companies + contacts (counts look sane vs Mike's
  account); **OR**, if OData can't enumerate, STOP and decide the fallback (autocomplete-only search,
  partial mirror) before building the mirror. This gate de-risks P3.3/P3.4.
- **Tests:** OData query unit (URL building, paging), wrapper read methods.

### P3.3 — Schema: RealNex mirror tables + sync-job state
- **Builds:** Drizzle migration (descriptive name) for `realnex_companies`, `realnex_contacts`,
  `realnex_activities`, `realnex_groups` (mirror RealNex fields; `realnex_key` unique; `last_synced_at`;
  **no `version`/optimistic-lock** — RealNex is source of truth), and `realnex_sync_jobs` (or a
  generalized sync-jobs table) mirroring the `box_sync_jobs` shape.
- **Review gate:** schema + migration SQL reviewed before push (Phase-4/2.5a pattern).
- **Tests:** schema compiles; migration applies on deploy; a tsvector-style guard if any generated columns.

### P3.4 — Nightly READ-ONLY sync worker + manual refresh + status
- **Builds:** `lib/external/realnex/sync.ts` worker (pages OData → UPSERT mirror by `realnex_key`),
  job-runner integration (queued→running→completed/failed, throttled progress, orphan recovery via
  the shared instrumentation hook), `POST /api/realnex/sync` (202) + `GET /api/realnex/sync/status`,
  `system_state.last_sync_realnex`, cron entries in `railway.toml` **commented out** until the
  manual run is verified (Box pattern). **Zero write capability to RealNex — reads only.**
- **Review gate:** full sync runs on prod; mirror counts sane; re-sync idempotent; navigate-away/return
  works; THEN a follow-up commit enables the cron.
- **Tests:** worker upsert idempotency, status route, orphan recovery.

### P3.5 — Read UIs: `/companies` + `/contacts` (read from mirror)
**STATUS: COMPLETE & LIVE (2026-07-13)** — both list pages, the shared `resolveEntities` + `GET /api/realnex/resolve`, the keyboard-navigable `<RealNexEntitySearch>` typeahead, and LXD/SF columns (Option A `details` walk, migration 0009) are deployed. Company LXD (`details.userDataFields.userDate1`) VERIFIED = Lease Expiration via a 35/35 internal cross-check vs contacts' named `leaseExpiry`.
- **Builds:** list pages reading the **mirror** (fast), search/filter, React Query 60s polling +
  refetch-on-focus, `<LastUpdated />`, refresh button, `<ConnectRealNexBanner />` if `REALNEX_API_KEY`
  missing. **Read-only — no create yet.**
- **Dependency (2026-07-07):** this mirror-read + search plumbing is the **autocomplete source for
  P3.9 note-logging** (the priority write feature) - the contact/company resolver reads P3.5's data.
  P3.5 is **secondary in priority** to the note-logging write path, but they share the mirror-read layer.
- **Review gate:** lists render from mirror, search/filter work, freshness indicators present, deep-link/back work.
- **Tests:** route + component.

--- **write capability begins below, behind the P3.1 safety enforcement** ---

### P3.6 — Create methods in wrapper (`createCompany`, `createContact`, `appendActivity`)
**STATUS: BUILT & DEPLOYED (2026-07-13)** — added ONLY `appendActivity` (add-only child History; `realnexAppendObjectHistory` path-locked in the client). Wrapper now **13 methods** (12 GET + appendActivity); set-equality + forbidden (incl. move/re-parent) green; plant-and-catch re-verified. **`createCompany`/`createContact` deliberately DEFERRED** to their P3.7/P3.8 forms (minimal write surface — note-logging needs only the append).
- **Builds:** add EXACTLY those three create methods (no update/delete). Read the `CreateCompany`/
  `CreateContact`/`EditHistory` request schemas from `swagger.json`. Tag created records
  `Source: Dashboard`. Update `safe.test.ts` allowlist (set-equality now includes the 3 creates).
  After a live create, re-sync that one record into the mirror.
- **Review gate:** wrapper still exports zero update/delete (set-equality + forbidden tests pass);
  a **test create** on prod (a clearly-labeled `API_TEST_DELETE_<ts>` company) creates + re-syncs;
  **Reed verifies + manually deletes** the test record in RealNex (we cannot delete). ⚠️ Resolve the
  **"no schema" response** question first: does `POST company` return the new `companyKey` (body /
  `Location` header)? If not, define how we obtain it (re-query by name / autocomplete) — **W1→W2
  chaining depends on it.**
- **Tests:** safe.test (surface = reads + 3 creates), create integration (gated, manual confirm).

### P3.7 — Workflow 1 UI: Create Company
- **Builds:** create-company form — web search for Website, **Tenant always checked**, **prompt for
  Prospect**, conditional flags; duplicate-name check against the mirror first; confirmation modal;
  `logActivity`; re-sync on success.
- **Review gate:** end-to-end create on prod (test record), website search works, flags correct,
  mirror reflects it after re-sync.
- **Tests:** form validation, flag logic, route.

### P3.8 — Workflow 2 UI: Create Contact
- **Builds:** create-contact form — **auto-derive Occupier/Prospect from the parent Company**,
  **Group = live dropdown from `listGroups`** (never free-text), chain to W1 if the company doesn't
  exist, attach contact to the company (depends on P3.6's key-resolution answer).
- **Review gate:** contact created under a company on prod; cascade flags correct; group sourced live;
  chain-to-W1 works.
- **Tests:** cascade logic, group dropdown source, route.

### P3.9 — Log History note (LOCAL-FIRST structured entry, no LLM) — the ALLOWED child-append — PRIORITY write feature (see "Scope decision", top)
**STATUS: BUILT + DEPLOYED (2026-07-13); LIVE TEST WRITE DEFERRED BY CHOICE.** The Log Note UI at `/activities` + `POST /api/realnex/activity` (auth-gated; validates; `eventTypeKey` restricted to the 6 note types; a confirm gate that states the exact target record before writing; audits success AND failure to `activity_feed`) are live and unit-tested (route + UI tests mock the write and pass). Reed deliberately chose NOT to perform the one real production-CRM append for a verification-only write, so the write path is **fully built + unit-tested but unexercised-on-prod** — exercisable later by Reed/Mike/Nadya on their own CRM when comfortable. A Cancel on the confirm screen was verified to write nothing (baselined Procopio stayed `totalCount=0`, parent unchanged).
- **Builds:** structured "Log Activity" form — Event Type dropdown from lookups
  (Note/Phone Call/Cold Call/Email/Meeting/Other), resolve the parent object key (company/contact)
  first, `appendActivity`. Two-entry activity-feed log. **No field edits to the parent — append only.**
- **Review gate:** history appended to an existing contact on prod; visible via `getObjectHistory`;
  confirmed it's a child append, parent fields untouched.
- **Tests:** object-key resolution, event-type mapping, route.

### P3.10 — Workflow 3 conversational parser — ⛔ DEFERRED (decision 2026-06-24)
**DEFERRED to a future Phase 3.x — not deleted, not in the Phase 3 v1 scope.** The structured
History form (**P3.9**) is the shipping path for Workflow 3 and covers the core need (log an
activity to an existing contact). Reasons for deferral, recorded for the team:
- **Privacy/DLP:** a conversational parser sends client interaction text to an **external LLM**.
  That requires a deliberate privacy/DLP review with Mike & Nadya before it's enabled — it is
  **not** a v1 default. **MEMORY's "Anthropic dropped 2026-05-21" decision remains authoritative;
  there is no contradiction — we are honoring it.**
- **Risk:** the parser is the most error-prone piece of Phase 3; deferring it materially lowers
  Phase 3 delivery risk.
- **Revisit trigger:** an explicit decision from Reed/Mike/Nadya after a privacy review, at which
  point this becomes Phase 3.x with: `ANTHROPIC_API_KEY` provisioning, a DLP review sign-off,
  confidence indicators, per-field confirmation on low confidence, and multi-gate confirm before
  any write. (Option (c), a non-LLM heuristic parser, stays on the table as a no-external-data
  alternative.)

### P3.11 — Workflow 4: Filter + Excel export (locked column order)
- **Builds:** filter UI over the mirror (Group, lease-expiration range, SF range, Tenant/Prospect),
  export `.xlsx` with **fixed column order: Company, Contact, Title, Email, Lease Expiration,
  Space Size (SF), Group**. Empty-state messaging per Nadya's doc.
- **Review gate:** export column order exactly matches; filters correct; clear "no matches" state.
- **Tests:** filter query, export column order assertion.

### P3.12 — Phase 3 stable
- **Builds:** enable the nightly sync cron (separate commit after manual verification, Box pattern);
  full E2E on prod; MEMORY.md → Phase 3 `[✓]` with final commit hashes, the workflow→endpoint map,
  E2E results, and Performance Baselines (sync duration, mirror size, list-query latency).

---

## Open questions / uncertainties (need Reed's input)

1. ~~Conversational Workflow 3 vs. the dropped-Anthropic decision (P3.10).~~ **RESOLVED 2026-06-24:
   DEFERRED.** Structured form (P3.9) is the v1 path for Workflow 3; P3.10 (conversational/Anthropic)
   is deferred pending a privacy/DLP review. MEMORY's "Anthropic dropped" decision stays authoritative.
2. **OData enumeration (P3.2).** The mirror's whole feasibility rests on OData being able to page all
   companies/contacts. If it can't, the architecture changes (search-only, no full mirror). P3.2 is a
   spike specifically to de-risk this *before* schema/mirror work.
3. **`POST company`/`POST contact` return "(no schema)" (P3.6).** Do they return the new record's key
   (body or `Location`)? W1→W2 chaining and immediate re-sync need that key. If not returned, we
   re-query by name/autocomplete — acceptable but worth confirming.
4. ~~Single identity = Mike's JWT.~~ **APPROVED for v1 (2026-06-24).** Everything the dashboard
   creates — every Company, Contact, and appended Activity — appears as **Mike-authored** in
   RealNex's audit trail (the JWT is Mike's). This is a known, documented tradeoff; per-user
   attribution (per-user JWT / service account) is a future enhancement, not v1.
5. **`REALNEX_API_KEY` in Railway.** Currently only in local `.env.local`. **Set in Railway via CLI
   at P3.1's prod-probe step — NOT before** (avoid a mid-planning deploy). Reed sets it when P3.1
   reaches that step. (Single value = Mike's token.)
6. **Tenant/Prospect/Occupier field mapping.** Nadya's doc uses checkboxes; the exact RealNex
   `CreateCompany`/`CreateContact` field names/representation are TBD — read from `swagger.json` in P3.6/7/8.
7. **Web search for Website (W1).** Which mechanism — the same Playwright/stdlib approach used by the
   newsletter agents, or a simpler fetch? Decide at P3.7.

## What I'm confident about
- Base URL `sync.realnex.com`, Bearer JWT, reachable through CBRE Zscaler (smoke test passed 2026-06-17).
- The read endpoints for companies/contacts/history/groups/lookups (documented, shapes known).
- The async-job + mirror + read-UI patterns (proven in Phase 2).
- The safety model (wrapper surface + pre-commit + vitest) — proven for Box; extends cleanly.

## Recommended starting point
**P3.1 + P3.2** as the first reviewable unit: stand up the read-only wrapper with full safety
enforcement, then immediately de-risk the OData enumeration question — because everything downstream
(mirror, lists, workflows) depends on those two. We do **not** write any RealNex create code until
P3.6, and not until you've approved this breakdown.
