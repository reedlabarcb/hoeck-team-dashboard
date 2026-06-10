-- Phase 2.5a Commit 7: one-time backfill so already-indexed PDFs become
-- discoverable by the text-extraction worker.
--
-- After this runs, box_folder_index.extraction_status = 'pending' for every PDF
-- that doesn't already have a status (i.e., was indexed before Phase 2.5a
-- shipped). The text-extraction worker's pull query
--   WHERE box_type='file' AND name ILIKE '%.pdf' AND extraction_status='pending'
-- will then immediately see all ~10k existing PDFs as work to do, no walker
-- re-run needed.
--
-- Idempotent: re-running this is a no-op because the WHERE clause filters to
-- NULL only. Drizzle's migrator marks the row complete via its own bookkeeping
-- table so re-runs don't actually re-execute.
--
-- Soft-deleted rows are skipped — they're already excluded from the worker query.

UPDATE box_folder_index
   SET extraction_status = 'pending',
       updated_by = 'migration_0006_backfill'
 WHERE box_type = 'file'
   AND name ILIKE '%.pdf'
   AND extraction_status IS NULL
   AND deleted_at IS NULL;
