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
  bigint,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const boxItemTypeEnum = pgEnum('box_item_type', ['file', 'folder', 'web_link']);

// Phase 2.5a: PDF text-extraction lifecycle.
// 'pending'              — row is a PDF, hasn't been processed yet (default for new PDFs)
// 'extracted'            — text successfully pulled with pdfplumber
// 'failed'               — extraction threw (see extraction_error)
// 'skipped_scanned'      — text-native check failed (<100 chars across >1 page); OCR is Phase 2.5b
// 'skipped_too_large'    — file size > 50 MB; deferred for a future opt-in path
export const extractionStatusEnum = pgEnum('extraction_status', [
  'pending',
  'extracted',
  'failed',
  'skipped_scanned',
  'skipped_too_large',
]);

// Custom Postgres `tsvector` type. Drizzle has no built-in helper; we declare it
// here so the schema TypeScript stays accurate. The runtime DDL for the actual
// column is overridden in migration 0005_pdf_text_extraction.sql — see the
// comment block above `extractedTextTsvector` below.
const tsvector = customType<{ data: string; notNull: false; default: false }>({
  dataType() {
    return 'tsvector';
  },
});

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
    // bigint because Box folder rollup sizes can exceed 2.1 GB (INTEGER max).
    // mode:'number' keeps the JS-side type as plain `number` — safe up to 2^53 (~9 PB).
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
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

    // ----- Phase 2.5a: PDF text extraction -----
    // Populated by the text-extraction worker (lib/external/box/text-extractor.ts)
    // only when box_type='file' AND name ILIKE '%.pdf'. NULL for all non-PDF rows.
    //
    // Text-native PDFs only in 2.5a. Scanned PDFs are flagged 'skipped_scanned'
    // and surfaced in the UI with a "Scanned — not indexed" badge so users know
    // why those files aren't searchable. OCR is Phase 2.5b.
    extractedText: text('extracted_text'),
    extractionStatus: extractionStatusEnum('extraction_status'),
    extractionAttemptedAt: timestamp('extraction_attempted_at', { withTimezone: true }),
    extractionCompletedAt: timestamp('extraction_completed_at', { withTimezone: true }),
    extractionError: text('extraction_error'),
    pageCount: integer('page_count'),
    isTextNative: boolean('is_text_native'),

    // ============================================================
    // !!! GENERATED COLUMN — DO NOT WRITE TO FROM APP CODE !!!
    // ------------------------------------------------------------
    // This column is GENERATED ALWAYS AS STORED — its value is computed by
    // Postgres from `extractedText`, NOT supplied by Drizzle inserts/updates.
    //
    // The actual DDL is hand-edited in migration
    //   drizzle/0005_pdf_text_extraction.sql
    // to:
    //   "extracted_text_tsvector" tsvector
    //     GENERATED ALWAYS AS (to_tsvector('english', coalesce(extracted_text, ''))) STORED
    //
    // DO NOT `drizzle-kit push` or `drizzle-kit generate` over this column
    // without preserving the GENERATED clause in the produced SQL. Drizzle's
    // schema diff will think the column is a regular `tsvector` and emit a
    // plain DDL — that would silently break full-text search at deploy time.
    //
    // The vitest regression test
    //   lib/db/schema/box-folder-index.tsvector.test.ts
    // greps migration 0005 for "GENERATED ALWAYS AS" and fails CI if the
    // clause goes missing. Defense in depth alongside this comment.
    // ============================================================
    extractedTextTsvector: tsvector('extracted_text_tsvector'),

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
    // Phase 2.5a: speed up text-extraction worker's
    //   "next 10k pending PDFs ORDER BY box_modified_at DESC" query
    index('box_folder_index_extraction_status_idx').on(table.extractionStatus),
    // Phase 2.5a: GIN index for full-text search on the generated tsvector.
    // Declared here so Drizzle's schema diff knows about it; the actual CREATE
    // INDEX statement is in migration 0005_pdf_text_extraction.sql.
    index('box_folder_index_text_tsv_gin_idx')
      .using('gin', table.extractedTextTsvector),
  ],
);

export type BoxFolderIndexRow = typeof boxFolderIndex.$inferSelect;
export type NewBoxFolderIndexRow = typeof boxFolderIndex.$inferInsert;
