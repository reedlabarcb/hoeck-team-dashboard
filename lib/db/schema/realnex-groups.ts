/**
 * realnex_groups - read-only MIRROR of RealNex Object Groups (Phase 3).
 *
 * Source: GET /api/v1/Crm/group (paginated). This is the authoritative source for the
 * Workflow-2 "Group" dropdown - every contact must be assigned to an existing Group,
 * never free-text (BUILD_SPEC). The dropdown reads from this mirror (fast) and/or a
 * live listGroups() call. UPSERT by realnex_key. NO optimistic-locking version.
 */

import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const realnexGroups = pgTable(
  'realnex_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    realnexKey: text('realnex_key').notNull(), // ObjectGroup Key
    name: text('name'),
    raw: jsonb('raw').$type<Record<string, unknown>>(),

    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull().defaultNow(),
    lastSyncRunId: uuid('last_sync_run_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: text('created_by').notNull().default('realnex_sync'),
    updatedBy: text('updated_by').notNull().default('realnex_sync'),
  },
  (t) => [uniqueIndex('realnex_groups_key_unique').on(t.realnexKey)],
);

export type RealnexGroupRow = typeof realnexGroups.$inferSelect;
export type NewRealnexGroupRow = typeof realnexGroups.$inferInsert;
