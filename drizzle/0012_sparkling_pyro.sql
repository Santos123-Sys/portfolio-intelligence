ALTER TABLE "discovery_candidates" ADD COLUMN "industry" text;--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD COLUMN "classification_source" text DEFAULT 'unclassified' NOT NULL;