ALTER TABLE agentic_jobs
  DROP CONSTRAINT IF EXISTS agentic_jobs_kind_check;

ALTER TABLE agentic_jobs
  ADD CONSTRAINT agentic_jobs_kind_check
  CHECK (kind IN ('analysis_run', 'thesis_extraction', 'market_discovery'));
