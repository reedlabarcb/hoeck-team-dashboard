/**
 * box_folder_index — flattened cache of the Tenants – ChapmanHoeck Box folder tree.
 *
 * Source of truth: Box itself. This table is a queryable mirror so:
 *   - /files renders fast (no per-page Box API call)
 *   - Search across the whole tree is one SQL query, not N HTTP calls
 *   - Convention parsing (DEAL_FOLDER_PATTERN) happens once per folder, at indexing time
 *
 * Updated by:
 *   - Manual "Refresh from Box" button (POST /api/box/reindex)
 *   - Nightly cron `npm run sync:box` (Railway daily 4 AM Pacific)
 *
 * Row lifecycle:
 *   - On each walk: upsert by box_id; set last_seen_at = NOW()
 *   - Rows whose last_seen_at didn't advance after a walk are flagged via the
 *     last_walk_run_at comparison (handled in the walker query, not via DELETE)
 *   - Soft-delete via deleted_at only — never hard DELETE
 *
 * Convention parsing fields are NULL when the folder name doesn't match
 * DEAL_FOLDER_PATTERN. Phase-2-and-later UI can filter on those for fast queries.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const boxItemTypeEnum = pgEnum('box_item_type', ['file', 'folder', 'web_link']);

export const boxFolderIndex = pgTable(
  'box_folder_index',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Native Box identity
    boxId: text('box_id').notNull(),
    boxType: boxItemTypeEnum('box_type').notNull(),
    name: text('name').notNull(),

    // Tree position
    parentBoxId: text('parent_box_id'), // null for the root folder we walked
    depth: integer('depth').notNull(), // 0 for root, 1 for direct children, ...
    pathSegments: jsonb('path_segments').notNull().default([]).$type<string[]>(),

    // Box metadata snapshots
    boxModifiedAt: timestamp('box_modified_at', { withTimezone: true }),
    sizeBytes: integer('size_bytes'),
    // For web_link items: the resolved URL (subleases shortcut shows up as web_link in some accounts)
    webLinkUrl: text('web_link_url'),
    isSubleaseShortcut: boolean('is_sublease_shortcut').notNull().default(false),

    // Convention parsing (DEAL_FOLDER_PATTERN) — populated by the walker, null when N/A
    yearStart: integer('year_start'),
    yearEnd: integer('year_end'),
    dealType: text('deal_type'), // 'Acquisition' | 'Disposition'
    address: text('address'),

    // Client folder context (filled when this row is a client folder OR sits under one)
    clientFolderName: text('client_folder_name'),
    isMtClient: boolean('is_mt_client').notNull().default(false), // ends with " – MT"
    marketSubfolder: text('market_subfolder'), // e.g. "Oregon" for MT clients

    // Walker bookkeeping
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastWalkRunId: uuid('last_walk_run_id'), // groups rows updated by the same walk

    // Standard housekeeping
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: text('created_by').notNull().default(sql`'box_walker'`),
    updatedBy: text('updated_by').notNull().default(sql`'box_walker'`),
  },
  (table) => [
    uniqueIndex('box_folder_index_box_id_unique').on(table.boxId),
    index('box_folder_index_parent_idx').on(table.parentBoxId),
    index('box_folder_index_type_idx').on(table.boxType),
    index('box_folder_index_year_idx').on(table.yearStart),
    index('box_folder_index_deal_type_idx').on(table.dealType),
    index('box_folder_index_client_idx').on(table.clientFolderName),
    index('box_folder_index_name_idx').on(table.name),
  ],
);

export type BoxFolderIndexRow = typeof boxFolderIndex.$inferSelect;
export type NewBoxFolderIndexRow = typeof boxFolderIndex.$inferInsert;
