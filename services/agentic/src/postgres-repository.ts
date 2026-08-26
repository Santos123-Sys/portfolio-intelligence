import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type { AgenticJob, CallbackStatus, JobKind, JobRepository, JobStatus } from './types.js';

type Sql = ReturnType<typeof postgres>;
type Row = Record<string, unknown>;

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function mapJob(row: Row): AgenticJob {
  return {
    id: String(row.id),
    externalId: String(row.external_id),
    kind: row.kind as JobKind,
    status: row.status as JobStatus,
    payload: row.payload_json as AgenticJob['payload'],
    result: (row.result_json ?? null) as AgenticJob['result'],
    errorMessage: row.error_message == null ? null : String(row.error_message),
    failedStage: row.failed_stage == null ? null : String(row.failed_stage),
    progressCompleted: Number(row.progress_completed),
    progressTotal: Number(row.progress_total),
    currentStage: String(row.current_stage),
    attemptCount: Number(row.attempt_count),
    manifestHash: row.manifest_hash == null ? null : String(row.manifest_hash),
    reportObjectKey: row.report_object_key == null ? null : String(row.report_object_key),
    reportPdf: row.report_pdf == null ? null : Buffer.from(row.report_pdf as Uint8Array),
    callbackStatus: row.callback_status as CallbackStatus,
    callbackAttempts: Number(row.callback_attempts),
    callbackError: row.callback_error == null ? null : String(row.callback_error),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
    completedAt: row.completed_at == null ? null : asDate(row.completed_at),
  };
}

export class PostgresJobRepository implements JobRepository {
  readonly sql: Sql;

  constructor(connectionString: string) {
    this.sql = postgres(connectionString, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 15,
      transform: { undefined: null },
    });
  }

  async ping(): Promise<void> {
    await this.sql`select 1`;
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }

  async create(kind: JobKind, externalId: string, payload: unknown, progressTotal: number): Promise<AgenticJob> {
    const id = randomUUID();
    const rows = await this.sql<Row[]>`
      insert into agentic_jobs (id, external_id, kind, status, payload_json, progress_total)
      values (${id}, ${externalId}, ${kind}, 'queued', ${this.sql.json(payload as never)}, ${progressTotal})
      returning *
    `;
    return mapJob(rows[0]);
  }

  async findByExternalId(externalId: string): Promise<AgenticJob | null> {
    const rows = await this.sql<Row[]>`
      select * from agentic_jobs where external_id = ${externalId} limit 1
    `;
    return rows[0] ? mapJob(rows[0]) : null;
  }

  async retry(id: string): Promise<AgenticJob | null> {
    const rows = await this.sql<Row[]>`
      update agentic_jobs
      set status = case when failed_stage = 'callback' then 'completed' else 'queued' end,
          current_stage = case when failed_stage = 'callback' then 'callback_pending' else 'queued' end,
          callback_status = case when failed_stage = 'callback' then 'retry' else callback_status end,
          callback_next_at = case when failed_stage = 'callback' then now() else callback_next_at end,
          error_message = null, failed_stage = null, callback_error = null,
          lease_owner = null, lease_expires_at = null,
          completed_at = case when failed_stage = 'callback' then completed_at else null end,
          updated_at = now()
      where id = ${id} and status = 'failed'
      returning *
    `;
    return rows[0] ? mapJob(rows[0]) : null;
  }

  async claimNext(workerId: string, leaseSeconds: number): Promise<AgenticJob | null> {
    const rows = await this.sql<Row[]>`
      update agentic_jobs
      set status = 'running',
          current_stage = case when status = 'queued' then 'starting' else current_stage end,
          lease_owner = ${workerId},
          lease_expires_at = now() + (${leaseSeconds} * interval '1 second'),
          attempt_count = attempt_count + 1,
          updated_at = now()
      where id = (
        select id from agentic_jobs
        where (status = 'queued' or (status = 'running' and lease_expires_at < now()))
        order by created_at
        for update skip locked
        limit 1
      )
      returning *
    `;
    return rows[0] ? mapJob(rows[0]) : null;
  }

  async updateProgress(id: string, completed: number, total: number, stage: string): Promise<void> {
    await this.sql`
      update agentic_jobs
      set progress_completed = ${completed}, progress_total = ${total}, current_stage = ${stage},
          lease_expires_at = now() + interval '10 minutes', updated_at = now()
      where id = ${id}
    `;
  }

  async completeExtraction(id: string, result: AgenticJob['result']): Promise<void> {
    await this.sql`
      update agentic_jobs
      set status = 'completed', result_json = ${this.sql.json(result as never)}, current_stage = 'completed',
          progress_completed = progress_total, completed_at = now(), updated_at = now(),
          lease_owner = null, lease_expires_at = null
      where id = ${id}
    `;
  }

  async completeAnalysis(
    id: string,
    manifest: Extract<AgenticJob['result'], { schemaVersion: string }>,
    manifestHash: string,
    report: { objectKey: string | null; bytes: Buffer | null }
  ): Promise<void> {
    await this.sql`
      update agentic_jobs
      set status = 'completed', result_json = ${this.sql.json(manifest as never)}, manifest_hash = ${manifestHash},
          report_object_key = ${report.objectKey}, report_pdf = ${report.bytes}, callback_status = 'pending',
          callback_next_at = now(), current_stage = 'callback_pending', progress_completed = progress_total,
          completed_at = now(), updated_at = now(), lease_owner = null, lease_expires_at = null
      where id = ${id}
    `;
  }

  async fail(id: string, stage: string, safeMessage: string): Promise<void> {
    await this.sql`
      update agentic_jobs
      set status = 'failed', failed_stage = ${stage}, error_message = ${safeMessage}, current_stage = 'failed',
          callback_status = case when kind = 'analysis_run' then 'pending' else 'not_required' end,
          callback_next_at = case when kind = 'analysis_run' then now() else null end,
          completed_at = now(), updated_at = now(), lease_owner = null, lease_expires_at = null
      where id = ${id}
    `;
  }

  async claimCallback(): Promise<AgenticJob | null> {
    const rows = await this.sql<Row[]>`
      update agentic_jobs
      set callback_status = 'delivering', callback_attempts = callback_attempts + 1,
          callback_next_at = now() + interval '1 minute', updated_at = now()
      where id = (
        select id from agentic_jobs
        where kind = 'analysis_run'
          and (
            (callback_status in ('pending', 'retry') and (callback_next_at is null or callback_next_at <= now()))
            or (callback_status = 'delivering' and callback_next_at <= now())
          )
        order by callback_next_at nulls first, updated_at
        for update skip locked
        limit 1
      )
      returning *
    `;
    return rows[0] ? mapJob(rows[0]) : null;
  }

  async markCallbackDelivered(id: string): Promise<void> {
    await this.sql`
      update agentic_jobs
      set callback_status = 'delivered', callback_error = null, callback_next_at = null, updated_at = now()
      where id = ${id}
    `;
  }

  async scheduleCallbackRetry(id: string, error: string, nextAt: Date, permanent: boolean): Promise<void> {
    await this.sql`
      update agentic_jobs
      set callback_status = ${permanent ? 'permanent_failure' : 'retry'}, callback_error = ${error},
          callback_next_at = ${permanent ? null : nextAt},
          status = case when ${permanent} then 'failed' else status end,
          failed_stage = case when ${permanent} then 'callback' else failed_stage end,
          error_message = case when ${permanent} then 'Dashboard callback delivery failed after bounded retries' else error_message end,
          updated_at = now()
      where id = ${id}
    `;
  }
}
