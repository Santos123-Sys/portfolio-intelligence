import { getEnv } from '@/lib/env';
import { AgenticRunRequest, ExternalRunStatus } from './agentic-contract';
import { externalAgenticUrl } from './agentic-adapter';

export async function startExternalAgenticRun(input: AgenticRunRequest): Promise<ExternalRunStatus> {
  const env = getEnv();
  if (!env.AGENTIC_SYSTEM_BASE_URL) {
    throw new Error('AGENTIC_SYSTEM_BASE_URL is not configured');
  }

  const response = await fetch(externalAgenticUrl(env.AGENTIC_SYSTEM_BASE_URL, '/v1/analysis-runs'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(env.AGENTIC_SYSTEM_API_KEY
        ? { authorization: `Bearer ${env.AGENTIC_SYSTEM_API_KEY}` }
        : {}),
    },
    body: JSON.stringify(input),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`External Agentic System returned ${response.status}: ${(await response.text()).slice(0, 400)}`);
  }

  return ExternalRunStatus.parse(await response.json());
}

export async function fetchExternalAgenticRun(externalRunId: string): Promise<ExternalRunStatus> {
  const env = getEnv();
  if (!env.AGENTIC_SYSTEM_BASE_URL) {
    throw new Error('AGENTIC_SYSTEM_BASE_URL is not configured');
  }

  const response = await fetch(
    externalAgenticUrl(env.AGENTIC_SYSTEM_BASE_URL, `/v1/analysis-runs/${encodeURIComponent(externalRunId)}`),
    {
      headers: env.AGENTIC_SYSTEM_API_KEY
        ? { authorization: `Bearer ${env.AGENTIC_SYSTEM_API_KEY}` }
        : {},
      cache: 'no-store',
    }
  );

  if (!response.ok) {
    throw new Error(`External Agentic System returned ${response.status}: ${(await response.text()).slice(0, 400)}`);
  }

  return ExternalRunStatus.parse(await response.json());
}
