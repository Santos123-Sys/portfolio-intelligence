CREATE TABLE "discovery_universe_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"exchange" text NOT NULL,
	"records_json" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_universe_provider_exchange_idx" ON "discovery_universe_snapshots" USING btree ("provider","exchange");--> statement-breakpoint
CREATE INDEX "discovery_universe_expiry_idx" ON "discovery_universe_snapshots" USING btree ("expires_at");