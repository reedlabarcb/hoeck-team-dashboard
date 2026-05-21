CREATE TYPE "public"."box_item_type" AS ENUM('file', 'folder', 'web_link');--> statement-breakpoint
CREATE TABLE "box_folder_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"box_id" text NOT NULL,
	"box_type" "box_item_type" NOT NULL,
	"name" text NOT NULL,
	"parent_box_id" text,
	"depth" integer NOT NULL,
	"path_segments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"box_modified_at" timestamp with time zone,
	"size_bytes" integer,
	"web_link_url" text,
	"is_sublease_shortcut" boolean DEFAULT false NOT NULL,
	"year_start" integer,
	"year_end" integer,
	"deal_type" text,
	"address" text,
	"client_folder_name" text,
	"is_mt_client" boolean DEFAULT false NOT NULL,
	"market_subfolder" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_walk_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" text DEFAULT 'box_walker' NOT NULL,
	"updated_by" text DEFAULT 'box_walker' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "box_folder_index_box_id_unique" ON "box_folder_index" USING btree ("box_id");--> statement-breakpoint
CREATE INDEX "box_folder_index_parent_idx" ON "box_folder_index" USING btree ("parent_box_id");--> statement-breakpoint
CREATE INDEX "box_folder_index_type_idx" ON "box_folder_index" USING btree ("box_type");--> statement-breakpoint
CREATE INDEX "box_folder_index_year_idx" ON "box_folder_index" USING btree ("year_start");--> statement-breakpoint
CREATE INDEX "box_folder_index_deal_type_idx" ON "box_folder_index" USING btree ("deal_type");--> statement-breakpoint
CREATE INDEX "box_folder_index_client_idx" ON "box_folder_index" USING btree ("client_folder_name");--> statement-breakpoint
CREATE INDEX "box_folder_index_name_idx" ON "box_folder_index" USING btree ("name");