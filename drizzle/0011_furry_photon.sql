CREATE TABLE "governance_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"max_position_weight" real DEFAULT 0.15 NOT NULL,
	"max_sector_weight" real DEFAULT 0.35 NOT NULL,
	"max_country_weight" real DEFAULT 0.4 NOT NULL,
	"minimum_holdings" integer DEFAULT 5 NOT NULL,
	"stale_price_days" integer DEFAULT 7 NOT NULL,
	"stale_research_days" integer DEFAULT 90 NOT NULL,
	"review_interval_days" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decision_log" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "governance_policies" ADD CONSTRAINT "governance_policies_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "governance_policies_owner_idx" ON "governance_policies" USING btree ("owner_id");