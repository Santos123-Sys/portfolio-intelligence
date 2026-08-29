CREATE TABLE IF NOT EXISTS agentic_jobs (
  id uuid PRIMARY KEY,
  external_id text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('analysis_run', 'thesis_extraction', 'market_discovery')),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  payload_json jsonb NOT NULL,
  result_json jsonb,
  error_message text,
  failed_stage text,
  progress_completed integer NOT NULL DEFAULT 0,
  progress_total integer NOT NULL DEFAULT 0,
  current_stage text NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  lease_owner text,
  lease_expires_at timestamptz,
  manifest_hash text,
  report_object_key text,
  report_pdf bytea,
  callback_status text NOT NULL DEFAULT 'not_required'
    CHECK (callback_status IN ('not_required', 'pending', 'delivering', 'retry', 'delivered', 'permanent_failure')),
  callback_attempts integer NOT NULL DEFAULT 0,
  callback_next_at timestamptz,
  callback_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS agentic_jobs_queue_idx
  ON agentic_jobs (status, created_at);

CREATE INDEX IF NOT EXISTS agentic_jobs_callback_idx
  ON agentic_jobs (callback_status, callback_next_at);

CREATE TABLE IF NOT EXISTS agentic_schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
