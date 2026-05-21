/**
 * user_box_tokens — per-user OAuth 2.0 tokens for Box.
 *
 * One row per (dashboard user → Box account) link. When a user clicks "Connect Box",
 * we run the OAuth dance and insert a row here. Subsequent re-connects update in-place
 * via `ON CONFLICT (user_id) WHERE deleted_at IS NULL DO UPDATE`.
 *
 * Both access_token and refresh_token are stored ENCRYPTED via AES-256-GCM
 * (see lib/external/box/crypto.ts). Never store cleartext tokens.
 *
 * Lifecycle:
 *   - access_token expires after 60 minutes
 *   - refresh_token expires after 60 days of disuse
 *   - The token-refresh helper auto-refreshes if access_token is within 5 min of expiry,
 *     and rotates the refresh_token forward each time.
 */

import { pgTable, uuid, text, timestamp, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

export const userBoxTokens = pgTable(
  'user_box_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // From Box: the Box account these tokens belong to.
    // Useful so we can show "Connected as <login>" in the UI.
    boxUserId: text('box_user_id').notNull(),
    boxLogin: text('box_login'), // email-like; may be null on legacy tokens

    accessTokenEncrypted: text('access_token_encrypted').notNull(),
    refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),

    // When the access_token expires. We refresh proactively at expires_at - 5 min.
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    // Standard housekeeping
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: text('created_by').notNull().default(sql`'system'`),
    updatedBy: text('updated_by').notNull().default(sql`'system'`),
  },
  (table) => [
    // One active Box link per dashboard user. Reconnect updates in-place.
    uniqueIndex('user_box_tokens_user_id_active_unique')
      .on(table.userId)
      .where(sql`${table.deletedAt} IS NULL`),
    index('user_box_tokens_user_id_idx').on(table.userId),
  ],
);

export type UserBoxToken = typeof userBoxTokens.$inferSelect;
export type NewUserBoxToken = typeof userBoxTokens.$inferInsert;
