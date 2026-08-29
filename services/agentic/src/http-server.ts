import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  AgenticRunRequest,
  DiscoveryRunRequest,
  MAX_THESIS_BASE64_CHARACTERS,
  MAX_THESIS_PDF_BYTES,
  MAX_THESIS_TEXT_BYTES,
  ThesisExtractionRequest,
  validateRunRequestCoherence,
  type ExternalRunStatus,
  type DiscoveryRunStatus,
  type ThesisDocument,
  type ThesisExtractionStatus,
} from '@portfolio-intelligence/agentic-contract';
import { createExternalId } from './manifest.js';
import type { ReportStorage } from './storage.js';
import type { AgenticJob, JobRepository } from './types.js';

export interface HttpServerDependencies {
  repository: JobRepository;
  storage: Pick<ReportStorage, 'get'>;
  apiKey: string;
  internalBaseUrl?: string;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': data.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(data);
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function authorized(request: IncomingMessage, expectedKey: string): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  return timingSafeEqual(digest(header.slice(7)), digest(expectedKey));
}

async function readJson(request: IncomingMessage, limit = 16 * 1024 * 1024): Promise<unknown> {
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string' || contentType.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new HttpError(413, 'Request body is too large');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > limit) throw new HttpError(413, 'Request body is too large');
    chunks.push(buffer);
  }
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return JSON.parse(source);
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON');
  }
}

function validateThesisDocumentContent(document: ThesisDocument): void {
  if (
    document.contentBase64.length > MAX_THESIS_BASE64_CHARACTERS ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(document.contentBase64)
  ) {
    throw new HttpError(400, 'Thesis document encoding is invalid');
  }
  const content = Buffer.from(document.contentBase64, 'base64');
  if (!content.length || content.toString('base64') !== document.contentBase64) {
    throw new HttpError(400, 'Thesis document encoding is invalid');
  }
  if (document.mimeType === 'application/pdf') {
    if (content.length > MAX_THESIS_PDF_BYTES) throw new HttpError(413, 'PDF documents must not exceed 10 MB');
    if (content.subarray(0, 5).toString('ascii') !== '%PDF-') throw new HttpError(400, 'PDF signature is invalid');
    const trailer = content.subarray(Math.max(0, content.length - 4096)).toString('latin1');
    if (!trailer.includes('%%EOF')) throw new HttpError(400, 'PDF document is incomplete');
    if (/\/(?:JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|Encrypt)\b/i.test(content.toString('latin1'))) {
      throw new HttpError(400, 'Encrypted PDFs and PDFs containing active or embedded content are not accepted');
    }
    return;
  }
  if (content.length > MAX_THESIS_TEXT_BYTES) throw new HttpError(413, 'Text documents must not exceed 2 MB');
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(content);
    if (!source.trim() || source.includes('\u0000')) throw new Error('invalid text');
  } catch {
    throw new HttpError(400, 'Text documents must contain non-empty valid UTF-8');
  }
}

function reportUrl(baseUrl: string | undefined, externalId: string): string | undefined {
  return baseUrl
    ? new URL(`/v1/analysis-runs/${encodeURIComponent(externalId)}/report`, baseUrl).toString()
    : undefined;
}

function runStatus(job: AgenticJob, baseUrl?: string): ExternalRunStatus {
  const common = {
    externalRunId: job.externalId,
    status: job.status,
    updatedAt: job.updatedAt.toISOString(),
  } as const;
  if (job.status === 'queued' || job.status === 'running') {
    return {
      ...common,
      progress: {
        completed: job.progressCompleted,
        total: job.progressTotal,
        currentStage: job.currentStage,
      },
    };
  }
  if (job.status === 'failed') {
    return { ...common, errorMessage: job.errorMessage ?? 'Agentic analysis failed' };
  }
  if (!job.result || !('schemaVersion' in job.result)) {
    throw new HttpError(500, 'Completed run is missing its manifest');
  }
  const url = job.reportObjectKey || job.reportPdf ? reportUrl(baseUrl, job.externalId) : undefined;
  return { ...common, manifest: job.result, ...(url ? { reportPdfUrl: url } : {}) };
}

function extractionStatus(job: AgenticJob): ThesisExtractionStatus {
  const common = {
    externalExtractionId: job.externalId,
    status: job.status,
    updatedAt: job.updatedAt.toISOString(),
  } as const;
  if (job.status === 'failed') return { ...common, errorMessage: job.errorMessage ?? 'Thesis extraction failed' };
  if (job.status === 'completed') {
    if (!job.result || !('criteria' in job.result)) throw new HttpError(500, 'Completed extraction is missing its result');
    return { ...common, result: job.result };
  }
  return common;
}

function discoveryStatus(job: AgenticJob): DiscoveryRunStatus {
  const common = {
    externalDiscoveryId: job.externalId,
    status: job.status,
    updatedAt: job.updatedAt.toISOString(),
  } as const;
  if (job.status === 'failed') {
    return { ...common, errorMessage: job.errorMessage ?? 'Market discovery failed' };
  }
  if (job.status === 'completed') {
    if (!job.result || !('marketMandates' in job.result)) {
      throw new HttpError(500, 'Completed discovery is missing its result');
    }
    return { ...common, result: job.result };
  }
  return {
    ...common,
    progress: {
      completed: job.progressCompleted,
      total: job.progressTotal,
      currentStage: job.currentStage,
    },
  };
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function createAgenticHttpServer(deps: HttpServerDependencies) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://agentic.local');
      if (url.pathname === '/health' && request.method === 'GET') {
        await Promise.race([
          deps.repository.ping(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3_000)),
        ]);
        return sendJson(response, 200, { status: 'ok' });
      }

      if (!url.pathname.startsWith('/v1/')) throw new HttpError(404, 'Not found');
      if (!authorized(request, deps.apiKey)) throw new HttpError(401, 'Bearer authentication required');

      if (url.pathname === '/v1/analysis-runs' && request.method === 'POST') {
        const parsed = AgenticRunRequest.safeParse(await readJson(request));
        if (!parsed.success) throw new HttpError(400, 'Analysis run request failed contract validation');
        try {
          validateRunRequestCoherence(parsed.data);
        } catch (error) {
          throw new HttpError(400, error instanceof Error ? error.message : 'Analysis run request is incoherent');
        }
        const externalId = createExternalId('run');
        const total = parsed.data.securities.length + parsed.data.portfolios.length + 2;
        const job = await deps.repository.create('analysis_run', externalId, parsed.data, total);
        return sendJson(response, 202, runStatus(job, deps.internalBaseUrl));
      }

      if (url.pathname === '/v1/thesis-extractions' && request.method === 'POST') {
        const parsed = ThesisExtractionRequest.safeParse(
          await readJson(request, MAX_THESIS_BASE64_CHARACTERS + 16 * 1024)
        );
        if (!parsed.success) throw new HttpError(400, 'Thesis extraction request failed contract validation');
        validateThesisDocumentContent(parsed.data.document);
        const externalId = createExternalId('extraction');
        const job = await deps.repository.create('thesis_extraction', externalId, parsed.data, 1);
        return sendJson(response, 202, extractionStatus(job));
      }

      if (url.pathname === '/v1/discovery-runs' && request.method === 'POST') {
        const parsed = DiscoveryRunRequest.safeParse(await readJson(request, 8 * 1024 * 1024));
        if (!parsed.success) throw new HttpError(400, 'Discovery run request failed contract validation');
        const externalId = createExternalId('discovery');
        const job = await deps.repository.create('market_discovery', externalId, parsed.data, 1);
        return sendJson(response, 202, discoveryStatus(job));
      }

      const runReport = url.pathname.match(/^\/v1\/analysis-runs\/([^/]+)\/report$/);
      if (runReport && request.method === 'GET') {
        const job = await deps.repository.findByExternalId(decodeURIComponent(runReport[1]));
        if (!job || job.kind !== 'analysis_run') throw new HttpError(404, 'Analysis run not found');
        if (job.status !== 'completed') throw new HttpError(409, 'Report is not ready');
        const pdf = job.reportPdf ?? (job.reportObjectKey ? await deps.storage.get(job.reportObjectKey) : null);
        if (!pdf || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') throw new HttpError(500, 'Stored report is not a valid PDF');
        response.writeHead(200, {
          'content-type': 'application/pdf',
          'content-length': pdf.length,
          'content-disposition': `inline; filename="${job.externalId}.pdf"`,
          'cache-control': 'private, max-age=300',
          'x-content-type-options': 'nosniff',
        });
        response.end(pdf);
        return;
      }

      const runRetry = url.pathname.match(/^\/v1\/analysis-runs\/([^/]+)\/retry$/);
      if (runRetry && request.method === 'POST') {
        const existing = await deps.repository.findByExternalId(decodeURIComponent(runRetry[1]));
        if (!existing || existing.kind !== 'analysis_run') throw new HttpError(404, 'Analysis run not found');
        const retried = await deps.repository.retry(existing.id);
        if (!retried) throw new HttpError(409, 'Only failed runs can be retried');
        return sendJson(response, 202, runStatus(retried, deps.internalBaseUrl));
      }

      const extractionRetry = url.pathname.match(/^\/v1\/thesis-extractions\/([^/]+)\/retry$/);
      if (extractionRetry && request.method === 'POST') {
        const existing = await deps.repository.findByExternalId(decodeURIComponent(extractionRetry[1]));
        if (!existing || existing.kind !== 'thesis_extraction') throw new HttpError(404, 'Thesis extraction not found');
        const retried = await deps.repository.retry(existing.id);
        if (!retried) throw new HttpError(409, 'Only failed extractions can be retried');
        return sendJson(response, 202, extractionStatus(retried));
      }

      const discoveryRetry = url.pathname.match(/^\/v1\/discovery-runs\/([^/]+)\/retry$/);
      if (discoveryRetry && request.method === 'POST') {
        const existing = await deps.repository.findByExternalId(decodeURIComponent(discoveryRetry[1]));
        if (!existing || existing.kind !== 'market_discovery') throw new HttpError(404, 'Discovery run not found');
        const retried = await deps.repository.retry(existing.id);
        if (!retried) throw new HttpError(409, 'Only failed discovery runs can be retried');
        return sendJson(response, 202, discoveryStatus(retried));
      }

      const runMatch = url.pathname.match(/^\/v1\/analysis-runs\/([^/]+)$/);
      if (runMatch && request.method === 'GET') {
        const job = await deps.repository.findByExternalId(decodeURIComponent(runMatch[1]));
        if (!job || job.kind !== 'analysis_run') throw new HttpError(404, 'Analysis run not found');
        return sendJson(response, 200, runStatus(job, deps.internalBaseUrl));
      }

      const extractionMatch = url.pathname.match(/^\/v1\/thesis-extractions\/([^/]+)$/);
      if (extractionMatch && request.method === 'GET') {
        const job = await deps.repository.findByExternalId(decodeURIComponent(extractionMatch[1]));
        if (!job || job.kind !== 'thesis_extraction') throw new HttpError(404, 'Thesis extraction not found');
        return sendJson(response, 200, extractionStatus(job));
      }

      const discoveryMatch = url.pathname.match(/^\/v1\/discovery-runs\/([^/]+)$/);
      if (discoveryMatch && request.method === 'GET') {
        const job = await deps.repository.findByExternalId(decodeURIComponent(discoveryMatch[1]));
        if (!job || job.kind !== 'market_discovery') throw new HttpError(404, 'Discovery run not found');
        return sendJson(response, 200, discoveryStatus(job));
      }

      throw new HttpError(404, 'Not found');
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : 'Internal agentic service error';
      if (!response.headersSent) sendJson(response, status, { error: message });
      else response.destroy();
    }
  });
}
