<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Claude Code Session Rules — Hoeck Team Dashboard v3

## Session Start (MANDATORY, no exceptions)
1. Run `git status` and report output
2. Run `git log --oneline -10` and report output
3. Run `git stash list` and report output
4. Run `git log -1 --format='%cd %s'` and compare to the latest "Recent Changes" entry in `MEMORY.md`. If git is ahead of MEMORY.md, reconcile before doing new work.
5. Read `MEMORY.md` fully
6. Read `docs/LESSONS_LEARNED.md`
7. Read `docs/RealNex_Workflow.md` and `docs/Box_Workflow.md` if touching integrations
8. Summarize: current phase, last commit, what's planned today
9. Ask user to confirm before writing any code

If git history shows unexpected state (uncommitted changes, recent reverts, stashed work), STOP and ask the user before proceeding.

## Post-Edit Check (MANDATORY after every file change)
1. Run `git diff <file>` immediately after editing
2. Verify only intended lines changed
3. If unexpected changes appear, undo and ask the user
4. Run any relevant tests for that file

## Hard Rules
- NEVER add methods to `lib/external/realnex/safe.ts` beyond the allow-list (`listCompanies`, `getCompany`, `listContacts`, `getContact`, `listActivities`, `getActivity`, `listGroups`, `createCompany`, `createContact`, `createActivity`)
- NEVER add methods to `lib/external/box/safe.ts` beyond the allow-list (`listFolder`, `getFolder`, `getFile`, `getFileVersions`, `downloadFile`, `searchFolderTree`, `createFolder` [scoped to `Tenants – ChapmanHoeck/Clients/*`], `uploadNewFile`, `uploadNewVersion`, `renameDealFolder`)
- ONLY rename allowed is `renameDealFolder` with `DEAL_FOLDER_PATTERN`
- NEVER call DELETE on any application table (soft delete via `deleted_at` only)
- NEVER overwrite Master Excel — always `uploadNewVersion`
- NEVER edit existing Master Excel rows in v1
- NEVER commit secrets — use `.env.local` (gitignored)
- NEVER skip the session-start git ritual
- **Seed scripts must be idempotent.** Use `ON CONFLICT (...) DO NOTHING`. Never UPDATE or DELETE existing rows. Cite inbound-tracker commit `0fdcb2f` as the reason in any seed script comment.
- **No default credentials.** Seed scripts require per-user `SEED_<USERNAME>_PASSWORD` env vars; users without their var set must be skipped, never seeded with a fallback. No `changeme-*`, no `password123`, no defaults — ever. If you find yourself writing a default password, stop and re-read this rule.
- **Any cron job that writes to Postgres or Box must be commented out in `railway.toml` until its target integration is live.** Don't fire crons into the void.

## Workflow-Specific Rules
- Workflow 2 Contact: Occupier and Prospect checkboxes are AUTO-DERIVED from Company. Render read-only.
- Workflow 2: Group dropdown MUST come from `groups_mirror` or live `realnex.listGroups()`. Never free-text.
- Workflow 3 conversational: Confidence indicators required. Low confidence requires per-field confirmation.
- Workflow 4 export: column order FIXED — Company, Contact, Title, Email, Lease Expiration, Space Size, Group.
- Master Excel append: copy formulas from row above, adjust row references, never write static values to formula cells.
- Folder rename: client-side AND server-side validation. Year and deal type unchangeable.

## React Query Rules
- Every list/detail view uses React Query, not bare `fetch`
- Every view component renders `<LastUpdated query={...} />`
- Mutations use optimistic updates with `onError` rollback
- 409 Conflict responses trigger the conflict-resolution UI, not just rollback
- Global fetch wrapper: any 401 response from a `/api/*` route triggers `window.location.reload()` so the login screen takes over (motivated by golf-bd `1ca7202`)

## Next.js 16 Notes
- App Router only
- Server actions for form submissions where appropriate
- Route handlers in `app/api/*/route.ts`
- `output: 'standalone'` in `next.config.ts` for Railway deployment (motivated by inbound-tracker `ec15a33`)

## Testing
- `pytest` for Python scripts (formula copy, fuzzy match, date parsing) — Phase 4 onward
- `vitest` for TypeScript
- REQUIRED tests: `safe.test.ts` for each external wrapper, asserting forbidden methods are absent
- Test the optimistic-lock 409 path explicitly (Phase 7)

## Session End (MANDATORY)
1. Update `MEMORY.md` (Current Status, Recent Changes, Known Issues, Next Up)
2. `git diff` review
3. Commit with clear message
4. `git push`
5. Confirm push succeeded
6. Report to user: what was built, what's next, any open questions
