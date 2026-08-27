CREATE TABLE "authentication_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"event_type" text NOT NULL,
	"outcome" text NOT NULL,
	"identity_hash" text,
	"ip_hash" text,
	"user_agent_hash" text,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authentication_rate_limits" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_secret_encrypted" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_pending_secret_encrypted" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_recovery_code_hashes" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_last_used_step" integer;--> statement-breakpoint
ALTER TABLE "authentication_events" ADD CONSTRAINT "authentication_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "authentication_events_user_time_idx" ON "authentication_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "authentication_rate_limits_expiry_idx" ON "authentication_rate_limits" USING btree ("blocked_until");