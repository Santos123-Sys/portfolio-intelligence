CREATE TABLE "financial_document_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"pdf_base64" text NOT NULL,
	"sha256" text NOT NULL,
	"extraction_json" jsonb NOT NULL,
	"analysis_json" jsonb NOT NULL,
	"status" text DEFAULT 'awaiting_review' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "financial_document_drafts" ADD CONSTRAINT "financial_document_drafts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_document_drafts" ADD CONSTRAINT "financial_document_drafts_candidate_id_discovery_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."discovery_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "financial_document_owner_candidate_idx" ON "financial_document_drafts" USING btree ("owner_id","candidate_id","created_at");