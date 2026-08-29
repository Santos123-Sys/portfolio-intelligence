import type {
  AgenticRunRequest,
  DiscoveryRunRequest,
  MarketDiscoveryOutput,
  PortfolioAnalysisManifest,
  ThesisExtractionRequest,
  ThesisExtractionResult,
} from '@portfolio-intelligence/agentic-contract';

export type JobKind = 'analysis_run' | 'thesis_extraction' | 'market_discovery';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';
export type CallbackStatus =
  | 'not_required'
  | 'pending'
  | 'delivering'
  | 'retry'
  | 'delivered'
  | 'permanent_failure';

export interface AgenticJob {
  id: string;
  externalId: string;
  kind: JobKind;
  status: JobStatus;
  payload: AgenticRunRequest | ThesisExtractionRequest | DiscoveryRunRequest;
  result: PortfolioAnalysisManifest | ThesisExtractionResult | MarketDiscoveryOutput | null;
  errorMessage: string | null;
  failedStage: string | null;
  progressCompleted: number;
  progressTotal: number;
  currentStage: string;
  attemptCount: number;
  manifestHash: string | null;
  reportObjectKey: string | null;
  reportPdf: Buffer | null;
  callbackStatus: CallbackStatus;
  callbackAttempts: number;
  callbackError: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface JobRepository {
  ping(): Promise<void>;
  close(): Promise<void>;
  create(kind: JobKind, externalId: string, payload: unknown, progressTotal: number): Promise<AgenticJob>;
  findByExternalId(externalId: string): Promise<AgenticJob | null>;
  retry(id: string): Promise<AgenticJob | null>;
  claimNext(workerId: string, leaseSeconds: number): Promise<AgenticJob | null>;
  updateProgress(id: string, completed: number, total: number, stage: string): Promise<void>;
  completeExtraction(id: string, result: ThesisExtractionResult): Promise<void>;
  completeDiscovery(id: string, result: MarketDiscoveryOutput): Promise<void>;
  completeAnalysis(
    id: string,
    manifest: PortfolioAnalysisManifest,
    manifestHash: string,
    report: { objectKey: string | null; bytes: Buffer | null }
  ): Promise<void>;
  fail(id: string, stage: string, safeMessage: string): Promise<void>;
  claimCallback(): Promise<AgenticJob | null>;
  markCallbackDelivered(id: string): Promise<void>;
  scheduleCallbackRetry(id: string, error: string, nextAt: Date, permanent: boolean): Promise<void>;
}
