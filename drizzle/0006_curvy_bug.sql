CREATE TABLE "provider_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"endpoint" text NOT NULL,
	"called_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text NOT NULL,
	"http_status" integer,
	"duration_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "provider_calls_provider_called_idx" ON "provider_calls" USING btree ("provider","called_at");--> statement-breakpoint
CREATE INDEX "provider_calls_endpoint_outcome_idx" ON "provider_calls" USING btree ("provider","endpoint","outcome","called_at");