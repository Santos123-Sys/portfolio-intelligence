import type { AgenticImportRequest } from '@portfolio-intelligence/agentic-contract';
import type { AgenticJob } from './types.js';

export function callbackPayload(job: AgenticJob, reportBaseUrl?: string): AgenticImportRequest {
  if (job.kind !== 'analysis_run') throw new Error('Only analysis runs have callbacks');
  if (job.status === 'completed' && job.result && 'schemaVersion' in job.result) {
    return {
      externalRunId: job.externalId,
      status: 'completed',
      manifest: job.result,
      ...(reportBaseUrl
        ? { reportPdfUrl: new URL(`/v1/analysis-runs/${encodeURIComponent(job.externalId)}/report`, reportBaseUrl).toString() }
        : {}),
    };
  }
  return {
    externalRunId: job.externalId,
    status: 'failed',
    errorMessage: job.errorMessage ?? 'Agentic analysis failed',
    ...(['extraction', 'analysis', 'synthesis', 'render', 'upload', 'callback'].includes(job.failedStage ?? '')
      ? { failedStage: job.failedStage as 'extraction' | 'analysis' | 'synthesis' | 'render' | 'upload' | 'callback' }
      : {}),
  };
}

export async function deliverCallback(
  url: string,
  apiKey: string,
  payload: AgenticImportRequest,
  fetchImplementation: typeof fetch = fetch
): Promise<void> {
  const response = await fetchImplementation(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Dashboard callback returned HTTP ${response.status}`);
}

export function nextCallbackTime(attempt: number, now = Date.now()): Date {
  const delayMs = Math.min(10 * 60_000, 5_000 * 2 ** Math.max(0, attempt - 1));
  return new Date(now + delayMs);
}
