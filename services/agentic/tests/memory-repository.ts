import { randomUUID } from 'node:crypto';
import type { PortfolioAnalysisManifest, ThesisExtractionResult } from '@portfolio-intelligence/agentic-contract';
import type { AgenticJob, JobKind, JobRepository } from '../src/types.js';

export class MemoryRepository implements JobRepository {
  readonly jobs = new Map<string, AgenticJob>();

  async ping() {}
  async close() {}

  async create(kind: JobKind, externalId: string, payload: unknown, progressTotal: number) {
    const now = new Date();
    const job: AgenticJob = {
      id: randomUUID(),
      externalId,
      kind,
      status: 'queued',
      payload: payload as AgenticJob['payload'],
      result: null,
      errorMessage: null,
      failedStage: null,
      progressCompleted: 0,
      progressTotal,
      currentStage: 'queued',
      attemptCount: 0,
      manifestHash: null,
      reportObjectKey: null,
      reportPdf: null,
      callbackStatus: 'not_required',
      callbackAttempts: 0,
      callbackError: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  async findByExternalId(externalId: string) {
    return [...this.jobs.values()].find((job) => job.externalId === externalId) ?? null;
  }

  async retry(id: string) {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'failed') return null;
    job.status = job.failedStage === 'callback' ? 'completed' : 'queued';
    job.currentStage = job.failedStage === 'callback' ? 'callback_pending' : 'queued';
    job.errorMessage = null;
    job.failedStage = null;
    job.updatedAt = new Date();
    return job;
  }

  async claimNext(_workerId: string, _leaseSeconds: number) {
    const job = [...this.jobs.values()].find((candidate) => candidate.status === 'queued') ?? null;
    if (job) {
      job.status = 'running';
      job.attemptCount += 1;
      job.updatedAt = new Date();
    }
    return job;
  }

  async updateProgress(id: string, completed: number, total: number, stage: string) {
    const job = this.jobs.get(id)!;
    job.progressCompleted = completed;
    job.progressTotal = total;
    job.currentStage = stage;
    job.updatedAt = new Date();
  }

  async completeExtraction(id: string, result: ThesisExtractionResult) {
    const job = this.jobs.get(id)!;
    job.status = 'completed';
    job.result = result;
    job.progressCompleted = job.progressTotal;
    job.completedAt = job.updatedAt = new Date();
  }

  async completeAnalysis(
    id: string,
    result: PortfolioAnalysisManifest,
    hash: string,
    report: { objectKey: string | null; bytes: Buffer | null }
  ) {
    const job = this.jobs.get(id)!;
    job.status = 'completed';
    job.result = result;
    job.manifestHash = hash;
    job.reportObjectKey = report.objectKey;
    job.reportPdf = report.bytes;
    job.callbackStatus = 'pending';
    job.progressCompleted = job.progressTotal;
    job.completedAt = job.updatedAt = new Date();
  }

  async fail(id: string, stage: string, message: string) {
    const job = this.jobs.get(id)!;
    job.status = 'failed';
    job.failedStage = stage;
    job.errorMessage = message;
    job.callbackStatus = job.kind === 'analysis_run' ? 'pending' : 'not_required';
    job.completedAt = job.updatedAt = new Date();
  }

  async claimCallback() {
    const job = [...this.jobs.values()].find((candidate) =>
      candidate.callbackStatus === 'pending' || candidate.callbackStatus === 'retry'
    ) ?? null;
    if (job) {
      job.callbackStatus = 'delivering';
      job.callbackAttempts += 1;
    }
    return job;
  }

  async markCallbackDelivered(id: string) {
    this.jobs.get(id)!.callbackStatus = 'delivered';
  }

  async scheduleCallbackRetry(id: string, error: string, _nextAt: Date, permanent: boolean) {
    const job = this.jobs.get(id)!;
    job.callbackStatus = permanent ? 'permanent_failure' : 'retry';
    job.callbackError = error;
    if (permanent) {
      job.status = 'failed';
      job.failedStage = 'callback';
    }
  }
}
