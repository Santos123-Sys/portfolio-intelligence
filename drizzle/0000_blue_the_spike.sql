CREATE TABLE "ai_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"security_id" uuid NOT NULL,
	"thesis_version_id" uuid NOT NULL,
	"portfolio_candidate" boolean DEFAULT false NOT NULL,
	"portfolio_role" text NOT NULL,
	"investment_score" integer NOT NULL,
	"thesis_alignment_score" integer NOT NULL,
	"quality_score" integer,
	"growth_score" integer,
	"risk_score" integer,
	"dividend_score" integer,
	"fundamental_summary" text,
	"investment_thesis" text,
	"key_catalysts" jsonb,
	"key_risks" jsonb,
	"thesis_breakers" jsonb,
	"confidence_score" real NOT NULL,
	"grounded_in" jsonb,
	"information_gaps" jsonb,
	"external_run_id" uuid,
	"supersedes_id" uuid,
	"analysis_timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"data_timestamp" timestamp with time zone,
	"agent_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"alert_type" text NOT NULL,
	"severity" text NOT NULL,
	"portfolio_id" uuid,
	"security_id" uuid,
	"headline" text NOT NULL,
	"detail" text,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"decision_date" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"decision" text NOT NULL,
	"reasoning" text,
	"alternatives_considered" text,
	"outcome" text,
	"related_security_id" uuid,
	"related_portfolio_id" uuid
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_currency" text NOT NULL,
	"to_currency" text NOT NULL,
	"rate" numeric(20, 10) NOT NULL,
	"rate_date" date NOT NULL,
	"source" text DEFAULT 'ECB' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_locks" (
	"lock_name" text PRIMARY KEY NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"holder" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"portfolio_type" text NOT NULL,
	"base_currency" text NOT NULL,
	"investment_objective" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"security_id" uuid NOT NULL,
	"quantity" numeric(20, 8) NOT NULL,
	"avg_cost" numeric(20, 8) NOT NULL,
	"market_value_native" numeric(20, 4),
	"weight" real,
	"last_priced_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"security_id" uuid NOT NULL,
	"price_date" date NOT NULL,
	"close" numeric(20, 8) NOT NULL,
	"currency" text NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"metric_name" text NOT NULL,
	"value" real NOT NULL,
	"currency" text NOT NULL,
	"methodology" text NOT NULL,
	"confidence_level" real,
	"horizon_days" integer,
	"lookback_days" integer,
	"annualization_factor" integer,
	"caveat" text,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data_as_of" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "securities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"company_name" text NOT NULL,
	"exchange" text NOT NULL,
	"currency" text NOT NULL,
	"sector" text,
	"industry" text,
	"country" text,
	"isin" text
);
--> statement-breakpoint
CREATE TABLE "thesis_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"criteria_json" jsonb NOT NULL,
	"raw_document" text,
	"effective_date" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"security_id" uuid,
	"txn_date" date NOT NULL,
	"side" text NOT NULL,
	"quantity" numeric(20, 8),
	"price" numeric(20, 8),
	"fees" numeric(20, 4) DEFAULT '0',
	"currency" text NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "candidate_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"analysis_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"rationale" text,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "external_agentic_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"security_id" uuid NOT NULL,
	"analysis_id" uuid NOT NULL,
	"output_json" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_agentic_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"external_run_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"thesis_version" text,
	"manifest_schema_version" text,
	"manifest_hash" text,
	"request_json" jsonb,
	"manifest_json" jsonb,
	"report_pdf_url" text,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"imported_at" timestamp,
	"error_message" text,
	CONSTRAINT "external_agentic_runs_external_run_id_unique" UNIQUE("external_run_id")
);
--> statement-breakpoint
CREATE TABLE "market_data_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"security_id" uuid NOT NULL,
	"observation_type" text NOT NULL,
	"metric_name" text NOT NULL,
	"value_numeric" numeric(24, 10),
	"value_text" text,
	"currency" text,
	"observation_date" text,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" text NOT NULL,
	"source_name" text,
	"source_url" text,
	"query" text,
	"status" text NOT NULL,
	"evidence_snippet" text,
	"raw_payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "portfolio_analysis_syntheses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"thesis_version" text NOT NULL,
	"synthesis_json" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thesis_mutation_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"thesis_version_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_thesis_version_id_thesis_versions_id_fk" FOREIGN KEY ("thesis_version_id") REFERENCES "public"."thesis_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_log" ADD CONSTRAINT "decision_log_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_log" ADD CONSTRAINT "decision_log_related_security_id_securities_id_fk" FOREIGN KEY ("related_security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_log" ADD CONSTRAINT "decision_log_related_portfolio_id_portfolios_id_fk" FOREIGN KEY ("related_portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_metrics" ADD CONSTRAINT "risk_metrics_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_versions" ADD CONSTRAINT "thesis_versions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_decisions" ADD CONSTRAINT "candidate_decisions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_decisions" ADD CONSTRAINT "candidate_decisions_analysis_id_ai_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."ai_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_agentic_analyses" ADD CONSTRAINT "external_agentic_analyses_run_id_external_agentic_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."external_agentic_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_agentic_analyses" ADD CONSTRAINT "external_agentic_analyses_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_agentic_analyses" ADD CONSTRAINT "external_agentic_analyses_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_agentic_analyses" ADD CONSTRAINT "external_agentic_analyses_analysis_id_ai_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."ai_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_agentic_runs" ADD CONSTRAINT "external_agentic_runs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_data_observations" ADD CONSTRAINT "market_data_observations_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_analysis_syntheses" ADD CONSTRAINT "portfolio_analysis_syntheses_run_id_external_agentic_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."external_agentic_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_analysis_syntheses" ADD CONSTRAINT "portfolio_analysis_syntheses_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_mutation_audit" ADD CONSTRAINT "thesis_mutation_audit_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_mutation_audit" ADD CONSTRAINT "thesis_mutation_audit_thesis_version_id_thesis_versions_id_fk" FOREIGN KEY ("thesis_version_id") REFERENCES "public"."thesis_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_analyses_security_idx" ON "ai_analyses" USING btree ("security_id");--> statement-breakpoint
CREATE INDEX "ai_analyses_timestamp_idx" ON "ai_analyses" USING btree ("analysis_timestamp");--> statement-breakpoint
CREATE INDEX "alerts_created_idx" ON "alerts" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fx_rates_pair_date_idx" ON "fx_rates" USING btree ("from_currency","to_currency","rate_date");--> statement-breakpoint
CREATE INDEX "portfolios_owner_idx" ON "portfolios" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "positions_portfolio_idx" ON "positions" USING btree ("portfolio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_portfolio_security_idx" ON "positions" USING btree ("portfolio_id","security_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_history_security_date_idx" ON "price_history" USING btree ("security_id","price_date");--> statement-breakpoint
CREATE INDEX "risk_metrics_portfolio_metric_idx" ON "risk_metrics" USING btree ("portfolio_id","metric_name","computed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "securities_ticker_exchange_idx" ON "securities" USING btree ("ticker","exchange");--> statement-breakpoint
CREATE UNIQUE INDEX "thesis_versions_owner_version_idx" ON "thesis_versions" USING btree ("owner_id","version_number");--> statement-breakpoint
CREATE INDEX "transactions_portfolio_date_idx" ON "transactions" USING btree ("portfolio_id","txn_date");--> statement-breakpoint
CREATE UNIQUE INDEX "user_sessions_token_hash_idx" ON "user_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "user_sessions_user_expiry_idx" ON "user_sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "candidate_decisions_analysis_idx" ON "candidate_decisions" USING btree ("analysis_id","decided_at");--> statement-breakpoint
CREATE UNIQUE INDEX "external_analysis_run_portfolio_security_idx" ON "external_agentic_analyses" USING btree ("run_id","portfolio_id","security_id");--> statement-breakpoint
CREATE INDEX "external_agentic_runs_status_idx" ON "external_agentic_runs" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "external_agentic_runs_manifest_hash_idx" ON "external_agentic_runs" USING btree ("manifest_hash");--> statement-breakpoint
CREATE INDEX "market_observations_security_metric_idx" ON "market_data_observations" USING btree ("security_id","metric_name","retrieved_at");--> statement-breakpoint
CREATE INDEX "market_observations_status_idx" ON "market_data_observations" USING btree ("status","retrieved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_synthesis_run_portfolio_idx" ON "portfolio_analysis_syntheses" USING btree ("run_id","portfolio_id");--> statement-breakpoint
CREATE INDEX "thesis_mutation_audit_thesis_idx" ON "thesis_mutation_audit" USING btree ("thesis_version_id","created_at");