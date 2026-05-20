# Hoeck Team Dashboard

Internal tenant rep dashboard for the Hoeck/Chapman/Gorelov team at CBRE San Diego.

Integrates RealNex CRM + Box file storage with dashboard-native notes, tags, and activity feed.

See `BUILD_SPEC.md` for the full architecture, safety rules, and build phases.
See `docs/RealNex_Workflow.md` and `docs/Box_Workflow.md` for the source-of-truth workflows.

## Stack

- Next.js 16 + TypeScript
- Postgres on Railway
- Drizzle ORM
- TanStack Query
- Tailwind + shadcn/ui

## For developers

This project is built and maintained with Claude Code. Start every session by:

1. `git status && git log --oneline -10 && git stash list`
2. Read `MEMORY.md`
3. Read `AGENTS.md`
4. Summarize current state before writing any code

See `MEMORY.md` and `AGENTS.md` (created by Claude Code in Phase 1) for the session rituals.
