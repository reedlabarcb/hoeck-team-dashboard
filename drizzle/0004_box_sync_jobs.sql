CREATE TYPE "public"."box_sync_job_mode" AS ENUM('full', 'incremental');--> statement-breakpoint
CREATE TYPE "public"."box_sync_job_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "box_sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"walk_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"status" "box_sync_job_status" DEFAULT 'queued' NOT NULL,
	"sync_mode" "box_sync_job_mode" DEFAULT 'full' NOT NULL,
	"is_force_full" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"progress_folders_walked" integer DEFAULT 0 NOT NULL,
	"progress_files_indexed" integer DEFAULT 0 NOT NULL,
	"api_calls_made" integer DEFAULT 0 NOT NULL,
	"current_path" text,
	"total_folders_in_index" integer,
	"error_message" text,
	"triggered_by" text NOT NULL,
	"delta_cursor" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" text DEFAULT 'box_walker' NOT NULL,
	"updated_by" text DEFAULT 'box_walker' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "box_sync_jobs_status_updated_at_idx" ON "box_sync_jobs" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "box_sync_jobs_started_at_idx" ON "box_sync_jobs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "box_sync_jobs_status_idx" ON "box_sync_jobs" USING btree ("status");--> statement-breakpoint
ALTER TABLE "box_sync_jobs" ADD CONSTRAINT "box_sync_jobs_triggered_by_not_empty" CHECK (triggered_by <> '');