CREATE TABLE "user_box_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"box_user_id" text NOT NULL,
	"box_login" text,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" text DEFAULT 'system' NOT NULL,
	"updated_by" text DEFAULT 'system' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_box_tokens" ADD CONSTRAINT "user_box_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_box_tokens_user_id_active_unique" ON "user_box_tokens" USING btree ("user_id") WHERE "user_box_tokens"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "user_box_tokens_user_id_idx" ON "user_box_tokens" USING btree ("user_id");