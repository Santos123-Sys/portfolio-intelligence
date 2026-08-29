import { getEnv } from '@/lib/env';
import {
  AgenticRunRequest,
  DiscoveryRunRequest,
  DiscoveryRunStatus,
  ExternalRunStatus,
  ThesisExtractionRequest,
  ThesisExtractionStatus,
} from './agentic-contract';
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

export async function startExternalDiscoveryRun(
  input: DiscoveryRunRequest
): Promise<DiscoveryRunStatus> {
  const response = await agenticFetch('/v1/discovery-runs', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return DiscoveryRunStatus.parse(await response.json());
}

export async function fetchExternalDiscoveryRun(
  externalDiscoveryId: string
): Promise<DiscoveryRunStatus> {
  const response = await agenticFetch(
    `/v1/discovery-runs/${encodeURIComponent(externalDiscoveryId)}`
  );
  return DiscoveryRunStatus.parse(await response.json());
}

export async function retryExternalDiscoveryRun(
  externalDiscoveryId: string
): Promise<DiscoveryRunStatus> {
  const response = await agenticFetch(
    `/v1/discovery-runs/${encodeURIComponent(externalDiscoveryId)}/retry`,
    { method: 'POST' }
  );
  return DiscoveryRunStatus.parse(await response.json());
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

export async function fetchExternalAgenticReport(externalRunId: string): Promise<Response> {
  const env = getEnv();
  if (!env.AGENTIC_SYSTEM_BASE_URL) throw new Error('AGENTIC_SYSTEM_BASE_URL is not configured');
  const response = await fetch(
    externalAgenticUrl(env.AGENTIC_SYSTEM_BASE_URL, `/v1/analysis-runs/${encodeURIComponent(externalRunId)}/report`),
    {
      headers: env.AGENTIC_SYSTEM_API_KEY
        ? { authorization: `Bearer ${env.AGENTIC_SYSTEM_API_KEY}` }
        : {},
      cache: 'no-store',
    }
  );
  if (!response.ok) {
    throw new Error(`External report endpoint returned ${response.status}: ${(await response.text()).slice(0, 400)}`);
  }
  return response;
}

export async function startExternalThesisExtraction(
  input: ThesisExtractionRequest
): Promise<ThesisExtractionStatus> {
  const response = await agenticFetch('/v1/thesis-extractions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return ThesisExtractionStatus.parse(await response.json());
}

export async function fetchExternalThesisExtraction(
  externalExtractionId: string
): Promise<ThesisExtractionStatus> {
  const response = await agenticFetch(
    `/v1/thesis-extractions/${encodeURIComponent(externalExtractionId)}`
  );
  return ThesisExtractionStatus.parse(await response.json());
}

export async function retryExternalAgenticJob(
  kind: 'analysis-runs' | 'thesis-extractions',
  externalId: string
): Promise<ExternalRunStatus | ThesisExtractionStatus> {
  const response = await agenticFetch(`/v1/${kind}/${encodeURIComponent(externalId)}/retry`, {
    method: 'POST',
  });
  const payload = await response.json();
  return kind === 'analysis-runs'
    ? ExternalRunStatus.parse(payload)
    : ThesisExtractionStatus.parse(payload);
}

async function agenticFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const env = getEnv();
  if (!env.AGENTIC_SYSTEM_BASE_URL || !env.AGENTIC_SYSTEM_API_KEY) {
    throw new Error('Agentic System connection is not configured');
  }
  const response = await fetch(externalAgenticUrl(env.AGENTIC_SYSTEM_BASE_URL, path), {
    ...init,
    headers: {
      authorization: `Bearer ${env.AGENTIC_SYSTEM_API_KEY}`,
      'content-type': 'application/json',
      ...init.headers,
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`External Agentic System returned ${response.status}: ${(await response.text()).slice(0, 400)}`);
  }
  return response;
}
