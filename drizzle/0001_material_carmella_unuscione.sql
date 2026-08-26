CREATE TABLE "external_thesis_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"external_extraction_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"requested_version" integer NOT NULL,
	"source_file_name" text NOT NULL,
	"source_mime_type" text NOT NULL,
	"result_json" jsonb,
	"error_message" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"confirmed_thesis_version_id" uuid,
	CONSTRAINT "external_thesis_extractions_external_extraction_id_unique" UNIQUE("external_extraction_id")
);
--> statement-breakpoint
ALTER TABLE "external_thesis_extractions" ADD CONSTRAINT "external_thesis_extractions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_thesis_extractions" ADD CONSTRAINT "external_thesis_extractions_confirmed_thesis_version_id_thesis_versions_id_fk" FOREIGN KEY ("confirmed_thesis_version_id") REFERENCES "public"."thesis_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_thesis_extractions_owner_status_idx" ON "external_thesis_extractions" USING btree ("owner_id","status","requested_at");