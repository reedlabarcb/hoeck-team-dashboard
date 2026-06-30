CREATE TYPE "public"."realnex_sync_job_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "realnex_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"realnex_key" text NOT NULL,
	"company_name" text,
	"company_name_normalized" text,
	"subsidiary_id" text,
	"investor" boolean,
	"tenant" boolean,
	"agent" boolean,
	"vendor" boolean,
	"personal" boolean,
	"prospect" boolean,
	"phone" text,
	"fax" text,
	"email" text,
	"website" text,
	"do_not_call" boolean,
	"do_not_email" boolean,
	"do_not_fax" boolean,
	"do_not_mail" boolean,
	"address" jsonb,
	"city" text,
	"state" text,
	"object_groups" jsonb DEFAULT '[]'::jsonb,
	"last_activity" jsonb,
	"last_activity_at" timestamp with time zone,
	"user_key" text,
	"team_key" text,
	"raw" jsonb,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" text DEFAULT 'realnex_sync' NOT NULL,
	"updated_by" text DEFAULT 'realnex_sync' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "realnex_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"realnex_key" text NOT NULL,
	"company_key" text,
	"company_name" text,
	"company_name_normalized" text,
	"full_name" text,
	"first_name" text,
	"last_name" text,
	"salutation" text,
	"greeting" text,
	"title" text,
	"investor" boolean,
	"tenant" boolean,
	"agent" boolean,
	"vendor" boolean,
	"personal" boolean,
	"prospect" boolean,
	"work" text,
	"fax" text,
	"mobile" text,
	"home" text,
	"email" text,
	"website" text,
	"do_not_call" boolean,
	"do_not_email" boolean,
	"do_not_fax" boolean,
	"do_not_mail" boolean,
	"address" jsonb,
	"mailing_address" jsonb,
	"object_groups" jsonb DEFAULT '[]'::jsonb,
	"last_activity" jsonb,
	"last_activity_at" timestamp with time zone,
	"user_key" text,
	"team_key" text,
	"raw" jsonb,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" text DEFAULT 'realnex_sync' NOT NULL,
	"updated_by" text DEFAULT 'realnex_sync' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "realnex_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"realnex_key" text NOT NULL,
	"name" text,
	"raw" jsonb,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" text DEFAULT 'realnex_sync' NOT NULL,
	"updated_by" text DEFAULT 'realnex_sync' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "realnex_sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" realnex_sync_job_status DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"current_phase" text,
	"companies_synced" integer DEFAULT 0 NOT NULL,
	"contacts_synced" integer DEFAULT 0 NOT NULL,
	"groups_synced" integer DEFAULT 0 NOT NULL,
	"links_resolved" integer DEFAULT 0 NOT NULL,
	"api_calls_made" integer DEFAULT 0 NOT NULL,
	"total_companies" integer,
	"total_contacts" integer,
	"error_message" text,
	"triggered_by" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" text DEFAULT 'realnex_sync' NOT NULL,
	"updated_by" text DEFAULT 'realnex_sync' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "realnex_companies_key_unique" ON "realnex_companies" USING btree ("realnex_key");--> statement-breakpoint
CREATE INDEX "realnex_companies_name_norm_idx" ON "realnex_companies" USING btree ("company_name_normalized");--> statement-breakpoint
CREATE INDEX "realnex_companies_tenant_idx" ON "realnex_companies" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "realnex_companies_prospect_idx" ON "realnex_companies" USING btree ("prospect");--> statement-breakpoint
CREATE INDEX "realnex_companies_deleted_idx" ON "realnex_companies" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "realnex_contacts_key_unique" ON "realnex_contacts" USING btree ("realnex_key");--> statement-breakpoint
CREATE INDEX "realnex_contacts_company_key_idx" ON "realnex_contacts" USING btree ("company_key");--> statement-breakpoint
CREATE INDEX "realnex_contacts_company_norm_idx" ON "realnex_contacts" USING btree ("company_name_normalized");--> statement-breakpoint
CREATE INDEX "realnex_contacts_email_idx" ON "realnex_contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "realnex_contacts_tenant_idx" ON "realnex_contacts" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "realnex_contacts_prospect_idx" ON "realnex_contacts" USING btree ("prospect");--> statement-breakpoint
CREATE INDEX "realnex_contacts_deleted_idx" ON "realnex_contacts" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "realnex_groups_key_unique" ON "realnex_groups" USING btree ("realnex_key");--> statement-breakpoint
CREATE INDEX "realnex_sync_jobs_status_updated_at_idx" ON "realnex_sync_jobs" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "realnex_sync_jobs_started_at_idx" ON "realnex_sync_jobs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "realnex_sync_jobs_status_idx" ON "realnex_sync_jobs" USING btree ("status");--> statement-breakpoint
ALTER TABLE "realnex_sync_jobs" ADD CONSTRAINT "realnex_sync_jobs_triggered_by_not_empty" CHECK (triggered_by <> '');