import { createHash } from 'node:crypto';
import { AgenticImportRequest, PortfolioAnalysisManifest } from './agentic-contract';

export function manifestHash(manifest: PortfolioAnalysisManifest): string {
  return createHash('sha256')
    .update(JSON.stringify(manifest))
    .digest('hex');
}

export function validateManifest(input: unknown): AgenticImportRequest {
  return AgenticImportRequest.parse(input);
}

export function externalAgenticUrl(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}
