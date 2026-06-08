-- =============================================================================
-- Phase 2.5a — PDF text extraction (Commit 1: schema)
-- =============================================================================
-- This migration is HAND-EDITED on top of `drizzle-kit generate` output. The
-- only edit vs. the generator: the `extracted_text_tsvector` column is a
-- Postgres GENERATED column, not a plain tsvector. See the prominent comment
-- block in lib/db/schema/box-folder-index.ts above the `extractedTextTsvector`
-- field for the full "do not regenerate over this" warning.
--
-- Regression guard: scripts/check-generated-tsvector-migration.test.ts greps
-- this file for "GENERATED ALWAYS AS" and fails CI if the clause is missing.
--
-- Backfill note: existing box_sync_jobs rows get job_type='folder_walk' via the
-- NOT NULL DEFAULT — no separate UPDATE needed. PDF rows in box_folder_index
-- keep extraction_status NULL after this migration; the Phase 2.5a.7 "connect
-- the dots" commit will UPDATE them to 'pending' once the worker is ready.
-- =============================================================================

CREATE TYPE "public"."extraction_status" AS ENUM('pending', 'extracted', 'failed', 'skipped_scanned', 'skipped_too_large');--> statement-breakpoint
CREATE TYPE "public"."box_sync_job_type" AS ENUM('folder_walk', 'text_extraction');--> statement-breakpoint
ALTER TABLE "box_folder_index" ADD COLUMN "extracted_text" text;--> statement-breakpoint
ALTER TABLE "box_folder_index" ADD COLUMN "extraction_status" "extraction_status";--> statement-breakpoint
ALTER TABLE "box_folder_index" ADD COLUMN "extraction_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "box_folder_index" ADD COLUMN "extraction_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "box_folder_index" ADD COLUMN "extraction_error" text;--> statement-breakpoint
ALTER TABLE "box_folder_index" ADD COLUMN "page_count" integer;--> statement-breakpoint
ALTER TABLE "box_folder_index" ADD COLUMN "is_text_native" boolean;--> statement-breakpoint
-- --- HAND-EDITED: extracted_text_tsvector is a GENERATED column ---
-- Drizzle's plain `ADD COLUMN "extracted_text_tsvector" "tsvector";` is replaced
-- with the GENERATED form below. Recomputed by Postgres on every INSERT/UPDATE
-- to extracted_text — application code MUST NOT write to this column.
ALTER TABLE "box_folder_index"
  ADD COLUMN "extracted_text_tsvector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("extracted_text", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "box_sync_jobs" ADD COLUMN "job_type" "box_sync_job_type" DEFAULT 'folder_walk' NOT NULL;--> statement-breakpoint
ALTER TABLE "box_sync_jobs" ADD COLUMN "progress_files_processed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "box_sync_jobs" ADD COLUMN "progress_files_succeeded" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "box_sync_jobs" ADD COLUMN "progress_files_failed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "box_sync_jobs" ADD COLUMN "progress_files_skipped" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "box_folder_index_extraction_status_idx" ON "box_folder_index" USING btree ("extraction_status");--> statement-breakpoint
CREATE INDEX "box_folder_index_text_tsv_gin_idx" ON "box_folder_index" USING gin ("extracted_text_tsvector");--> statement-breakpoint
CREATE INDEX "box_sync_jobs_job_type_started_at_idx" ON "box_sync_jobs" USING btree ("job_type","started_at");
