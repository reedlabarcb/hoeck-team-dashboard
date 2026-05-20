/**
 * activity_feed — append-only audit log of every meaningful action in the dashboard.
 *
 * Rules:
 *   - Append-only. No UPDATE, no DELETE. (Activity is history; rewriting history is dishonest.)
 *   - `payload` is JSONB and stores whatever extra context the caller wants — diffs,
 *     IDs of related entities, source-of-truth links.
 *   - `status` flags special cases like 'destructive_rename' (Box folder rename) so the
 *     UI can surface them prominently in the activity feed widget.
 *
 * No `version` / `deleted_at` here — append-only by design.
 */

import { pgTable, uuid, text, timestamp, jsonb, pgEnum } from 'drizzle-orm/pg-core';
import { users } from './users';

export const activityStatusEnum = pgEnum('activity_status', [
  'ok',
  'warn',
  'error',
  'destructive_rename',
]);

export const activityFeed = pgTable('activity_feed', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  action: text('action').notNull(), // e.g. 'company.create', 'box.folder.rename', 'master_excel.append'
  entityType: text('entity_type'), // e.g. 'realnex_company', 'box_folder', 'master_excel_row'
  entityId: text('entity_id'),
  payload: jsonb('payload').notNull().default({}),
  status: activityStatusEnum('status').notNull().default('ok'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ActivityFeedEntry = typeof activityFeed.$inferSelect;
export type NewActivityFeedEntry = typeof activityFeed.$inferInsert;
