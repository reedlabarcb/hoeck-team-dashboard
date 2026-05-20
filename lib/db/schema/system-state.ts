/**
 * system_state — key/value table for cross-cutting state the frontend polls.
 *
 * Rows we populate over time:
 *   - 'last_sync_realnex'         { timestamp, result, counts: {...} }
 *   - 'last_sync_box'             { timestamp, result, indexed: number }
 *   - 'last_master_excel_modified' { box_modified_at, version }
 *   - 'last_write_at'              { timestamp }  // bumped on any application write
 *
 * The /api/system/last-write endpoint exposes this so React Query can invalidate
 * stale caches when a background sync completes (lineage: golf-bd 9b4cf2b — Brandon
 * never saw Reed's changes; this is the mechanism that fixes that class of bug).
 *
 * Upserts only — no soft delete, no version column. updated_at is the source of truth.
 */

import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const systemState = pgTable('system_state', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SystemStateRow = typeof systemState.$inferSelect;
export type NewSystemStateRow = typeof systemState.$inferInsert;

// Well-known keys
export const SYSTEM_STATE_KEYS = {
  LAST_SYNC_REALNEX: 'last_sync_realnex',
  LAST_SYNC_BOX: 'last_sync_box',
  LAST_MASTER_EXCEL_MODIFIED: 'last_master_excel_modified',
  LAST_WRITE_AT: 'last_write_at',
} as const;
