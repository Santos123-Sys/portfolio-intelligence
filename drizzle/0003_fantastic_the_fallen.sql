CREATE TABLE "agent_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"agent_kind" text NOT NULL,
	"version_number" integer NOT NULL,
	"name" text NOT NULL,
	"scope" text NOT NULL,
	"prompt_addendum" text DEFAULT '' NOT NULL,
	"enabled_tools" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"security_id" uuid,
	"ticker" text NOT NULL,
	"exchange" text NOT NULL,
	"company_name" text NOT NULL,
	"currency" text NOT NULL,
	"country" text,
	"sector" text,
	"discovery_json" jsonb NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"decision_rationale" text,
	"decided_at" timestamp with time zone,
	"workflow_status" text DEFAULT 'awaiting_review' NOT NULL,
	"external_analysis_run_id" text,
	"analysis_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_discovery_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"thesis_version_id" uuid NOT NULL,
	"external_discovery_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider" text NOT NULL,
	"request_json" jsonb NOT NULL,
	"result_json" jsonb,
	"error_message" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "external_discovery_runs_external_discovery_id_unique" UNIQUE("external_discovery_id")
);
--> statement-breakpoint
CREATE TABLE "security_risk_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"security_id" uuid NOT NULL,
	"metrics_json" jsonb NOT NULL,
	"provider" text NOT NULL,
	"data_as_of" timestamp with time zone NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valuation_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"analysis_id" uuid,
	"method" text NOT NULL,
	"status" text NOT NULL,
	"assumptions_json" jsonb NOT NULL,
	"result_json" jsonb NOT NULL,
	"source_references" jsonb NOT NULL,
	"approved_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_configurations" ADD CONSTRAINT "agent_configurations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_run_id_external_discovery_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."external_discovery_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_analysis_id_ai_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."ai_analyses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_discovery_runs" ADD CONSTRAINT "external_discovery_runs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_discovery_runs" ADD CONSTRAINT "external_discovery_runs_thesis_version_id_thesis_versions_id_fk" FOREIGN KEY ("thesis_version_id") REFERENCES "public"."thesis_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_risk_snapshots" ADD CONSTRAINT "security_risk_snapshots_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_risk_snapshots" ADD CONSTRAINT "security_risk_snapshots_candidate_id_discovery_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."discovery_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_risk_snapshots" ADD CONSTRAINT "security_risk_snapshots_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_scenarios" ADD CONSTRAINT "valuation_scenarios_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_scenarios" ADD CONSTRAINT "valuation_scenarios_candidate_id_discovery_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."discovery_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_scenarios" ADD CONSTRAINT "valuation_scenarios_analysis_id_ai_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."ai_analyses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_configs_owner_kind_version_idx" ON "agent_configurations" USING btree ("owner_id","agent_kind","version_number");--> statement-breakpoint
CREATE INDEX "agent_configs_owner_kind_active_idx" ON "agent_configurations" USING btree ("owner_id","agent_kind","active");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_candidates_run_security_idx" ON "discovery_candidates" USING btree ("run_id","portfolio_id","exchange","ticker");--> statement-breakpoint
CREATE INDEX "discovery_candidates_owner_workflow_idx" ON "discovery_candidates" USING btree ("owner_id","workflow_status","created_at");--> statement-breakpoint
CREATE INDEX "discovery_runs_owner_status_idx" ON "external_discovery_runs" USING btree ("owner_id","status","requested_at");--> statement-breakpoint
CREATE INDEX "security_risk_candidate_time_idx" ON "security_risk_snapshots" USING btree ("candidate_id","computed_at");--> statement-breakpoint
CREATE INDEX "valuation_candidate_created_idx" ON "valuation_scenarios" USING btree ("candidate_id","created_at");