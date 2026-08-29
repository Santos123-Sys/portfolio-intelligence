ALTER TABLE "external_thesis_extractions" ADD COLUMN "dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "external_thesis_extractions" ADD COLUMN "dismissed_by" text;