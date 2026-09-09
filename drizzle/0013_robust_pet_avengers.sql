CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"account_type" text DEFAULT 'advisory_client' NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"role" text NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "external_agentic_runs" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_owner_user_idx" ON "accounts" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_account_idx" ON "memberships" USING btree ("user_id","account_id");--> statement-breakpoint
CREATE INDEX "memberships_account_user_idx" ON "memberships" USING btree ("account_id","user_id");--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_check" CHECK ("role" IN ('owner', 'analyst', 'viewer'));--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'member';--> statement-breakpoint
UPDATE "users" SET "role" = 'platform_admin' WHERE "role" = 'owner';--> statement-breakpoint
INSERT INTO "accounts" ("name", "account_type", "owner_user_id")
SELECT "display_name", 'personal', "id" FROM "users"
ON CONFLICT ("owner_user_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "memberships" ("user_id", "account_id", "role", "accepted_at")
SELECT "owner_user_id", "id", 'owner', now() FROM "accounts"
ON CONFLICT ("user_id", "account_id") DO NOTHING;--> statement-breakpoint
UPDATE "external_agentic_runs" AS "run"
SET "account_id" = "accounts"."id"
FROM "accounts"
WHERE "accounts"."owner_user_id" = "run"."owner_id";--> statement-breakpoint
ALTER TABLE "external_agentic_runs" ALTER COLUMN "account_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "external_agentic_runs" ADD CONSTRAINT "external_agentic_runs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_agentic_runs_account_status_idx" ON "external_agentic_runs" USING btree ("account_id","status","requested_at");
