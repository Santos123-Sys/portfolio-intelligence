import type OpenAI from 'openai';
import {
  APIConnectionError,
  APIError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  RateLimitError,
} from 'openai';
import { describe, expect, it } from 'vitest';
import {
  AgenticPipelineError,
  OpenAIAgenticPipeline,
  resolveStageEffort,
  retrievedSourceUrls,
} from '../src/openai-pipeline.js';
import { callbackPayload } from '../src/callback.js';
import type { AgenticJob } from '../src/types.js';
import { portfolioId, thesis, thesisVersionId } from './fixtures.js';

const headers = new Headers();

function throwingClient(error: unknown): OpenAI {
  return { responses: { parse: async () => { throw error; } } } as unknown as OpenAI;
}

function pipelineThatThrows(error: unknown): OpenAIAgenticPipeline {
  return new OpenAIAgenticPipeline('unused-test-key', 'gpt-5.6', 'medium', throwingClient(error));
}

const textDocument = {
  version: 1,
  fileName: 'thesis.txt',
  mimeType: 'text/plain' as const,
  contentBase64: Buffer.from('A thesis').toString('base64'),
};

async function captureFailure(error: unknown): Promise<AgenticPipelineError> {
  try {
    await pipelineThatThrows(error).extractThesis(textDocument);
  } catch (caught) {
    return caught as AgenticPipelineError;
  }
  throw new Error('expected the pipeline to throw');
}

describe('provider error classification', () => {
  it('marks a rejected API key terminal and names the fix', async () => {
    const failure = await captureFailure(new AuthenticationError(401, {}, 'Incorrect API key', headers));
    expect(failure).toBeInstanceOf(AgenticPipelineError);
    expect(failure.retriable).toBe(false);
    expect(failure.message).toMatch(/401/);
    expect(failure.message).toMatch(/rotate OPENAI_API_KEY/);
    // The old blanket message claimed every failure was retriable.
    expect(failure.message).not.toMatch(/can be retried safely/);
  });

  it('marks a rejected request terminal rather than inviting a pointless retry', async () => {
    const failure = await captureFailure(new BadRequestError(400, {}, 'Invalid schema', headers));
    expect(failure.retriable).toBe(false);
    expect(failure.message).toMatch(/will not help/);
  });

  it('marks an unknown model terminal', async () => {
    const failure = await captureFailure(new NotFoundError(404, {}, 'No such model', headers));
    expect(failure.retriable).toBe(false);
    expect(failure.message).toMatch(/OPENAI_MODEL/);
  });

  it('marks rate limiting retriable', async () => {
    const failure = await captureFailure(new RateLimitError(429, {}, 'Slow down', headers));
    expect(failure.retriable).toBe(true);
    expect(failure.message).toMatch(/Safe to retry/);
  });

  it('marks a provider 5xx retriable', async () => {
    const failure = await captureFailure(new InternalServerError(503, {}, 'Unavailable', headers));
    expect(failure.retriable).toBe(true);
  });

  it('marks a connection failure retriable', async () => {
    const failure = await captureFailure(new APIConnectionError({ message: 'socket hang up' }));
    expect(failure.retriable).toBe(true);
  });

  it('falls back to the HTTP status for an unrecognised APIError', async () => {
    expect((await captureFailure(new APIError(418, {}, 'teapot', headers))).retriable).toBe(false);
    expect((await captureFailure(new APIError(502, {}, 'bad gateway', headers))).retriable).toBe(true);
  });

  it('treats a non-provider failure as possibly-transient model output', async () => {
    const failure = await captureFailure(new Error('zod parse blew up'));
    expect(failure.retriable).toBe(true);
    expect(failure.message).toMatch(/could not be parsed or validated/);
  });

  it('never echoes the provider message, which can carry request or key material', async () => {
    const secret = 'sk-live-SHOULD-NOT-APPEAR-anywhere';
    const failure = await captureFailure(new AuthenticationError(401, { message: secret }, secret, headers));
    expect(failure.message).not.toContain(secret);
  });

  it('reports the stage it failed in', async () => {
    expect((await captureFailure(new RateLimitError(429, {}, 'rl', headers))).stage).toBe('extraction');
  });
});

describe('per-stage reasoning effort', () => {
  it('applies a single effort to every stage', () => {
    expect(resolveStageEffort('high')).toEqual({
      extraction: 'high', analysis: 'high', synthesis: 'high', discovery: 'high',
    });
  });

  it('falls back per stage for gaps in a partial map', () => {
    expect(resolveStageEffort({ analysis: 'xhigh', discovery: 'high' }, 'low')).toEqual({
      extraction: 'low', analysis: 'xhigh', synthesis: 'low', discovery: 'high',
    });
  });

  it('defaults to medium when nothing is supplied', () => {
    expect(resolveStageEffort(undefined).analysis).toBe('medium');
  });

  it('sends the extraction effort, not the analysis one, on an extraction call', async () => {
    let sentEffort: string | undefined;
    const client = {
      responses: {
        parse: async (request: { reasoning?: { effort?: string } }) => {
          sentEffort = request.reasoning?.effort;
          return {
            output_parsed: {
              criteria: {
                version: 1,
                portfolios: [{
                  role: 'swiss_quality', currency: 'CHF', objective: 'Compounding',
                  inclusionCriteria: ['Moat'], exclusionCriteria: [], targetMetrics: [],
                }],
                globalConstraints: [],
              },
              extractionConfidence: 0.9,
              ambiguousPoints: [],
              unmappedContent: [],
            },
          };
        },
      },
    } as unknown as OpenAI;

    const pipeline = new OpenAIAgenticPipeline('unused-test-key', 'gpt-5.6',
      { extraction: 'low', analysis: 'xhigh' }, client);
    await pipeline.extractThesis(textDocument);
    expect(sentEffort).toBe('low');
  });
});

describe('retrievedSourceUrls', () => {
  it('harvests search-call sources and reports that search ran', () => {
    const result = retrievedSourceUrls({
      output: [{ type: 'web_search_call', action: { sources: [{ url: 'https://six-group.com/a' }] } }],
    });
    expect(result.urls).toEqual(['https://six-group.com/a']);
    expect(result.searchInvoked).toBe(true);
  });

  it('drops anything that is not an absolute http(s) URL', () => {
    // verifiedWebSources is z.array(z.string().url()) inside a .strict()
    // schema, so one bad entry would fail the parse and sink the whole run.
    const result = retrievedSourceUrls({
      output: [{
        type: 'web_search_call',
        action: { sources: [
          { url: 'https://ok.example/a' },
          { url: 'not a url' },
          { url: 'javascript:alert(1)' },
          { url: '' },
          { url: null },
        ] },
      }],
    });
    expect(result.urls).toEqual(['https://ok.example/a']);
  });

  it('also reads a results-shaped collection', () => {
    const result = retrievedSourceUrls({
      output: [{ type: 'web_search_call', results: [{ url: 'https://b3.com.br/x' }] }],
    });
    expect(result.urls).toEqual(['https://b3.com.br/x']);
  });

  it('harvests message annotations and de-duplicates across sources', () => {
    const result = retrievedSourceUrls({
      output: [
        { type: 'web_search_call', action: { sources: [{ url: 'https://dup.example/1' }] } },
        { type: 'message', content: [{ annotations: [{ url: 'https://dup.example/1' }, { url: 'https://other.example/2' }] }] },
      ],
    });
    expect(result.urls.sort()).toEqual(['https://dup.example/1', 'https://other.example/2']);
  });

  it('distinguishes "search never ran" from "search ran and yielded nothing"', () => {
    // The second case is how a provider response-shape change presents; without
    // the flag it is indistinguishable from a quiet legitimate result.
    expect(retrievedSourceUrls({ output: [{ type: 'message', content: [] }] }).searchInvoked).toBe(false);
    expect(retrievedSourceUrls({ output: [{ type: 'web_search_call', action: {} }] })).toEqual({
      urls: [], searchInvoked: true,
    });
  });

  it('survives a totally unexpected response shape', () => {
    expect(retrievedSourceUrls(null)).toEqual({ urls: [], searchInvoked: false });
    expect(retrievedSourceUrls({ output: 'not-an-array' })).toEqual({ urls: [], searchInvoked: false });
    expect(retrievedSourceUrls({ output: [null, 42, 'x'] })).toEqual({ urls: [], searchInvoked: false });
  });
});

describe('failed-stage reporting', () => {
  it('reports a discovery failure as discovery, not analysis', async () => {
    const pipeline = pipelineThatThrows(new RateLimitError(429, {}, 'rl', headers));
    await expect(
      pipeline.discoverSecurities({
        thesis: { versionId: thesisVersionId, criteria: thesis },
        portfolios: [{
          id: portfolioId,
          name: 'Swiss quality',
          role: 'swiss_quality',
          baseCurrency: 'CHF',
          investmentObjective: 'Capital preservation',
        }],
        universe: [{
          ticker: 'NESN', exchange: 'XSWX', companyName: 'Nestle S.A.', currency: 'CHF',
          country: 'CH', sector: 'Consumer Staples', industry: 'Packaged Foods',
          assetType: 'common_stock', observedAt: '2026-08-25T00:00:00.000Z',
          provider: 'stub', sourceUrl: 'https://example.test/universe/nesn',
          attributes: {},
        }],
        maxCandidatesPerPortfolio: 3,
      })
    ).rejects.toMatchObject({ stage: 'discovery' });
  });

  it('omits an internal stage the dashboard contract does not define', () => {
    // AgenticImportRequest is .strict(); sending 'discovery' would be rejected.
    const job = {
      kind: 'analysis_run', externalId: 'run-1', status: 'failed',
      errorMessage: 'boom', failedStage: 'discovery', result: null,
    } as unknown as AgenticJob;
    expect(callbackPayload(job)).not.toHaveProperty('failedStage');
  });

  it('still forwards a stage the contract does define', () => {
    const job = {
      kind: 'analysis_run', externalId: 'run-2', status: 'failed',
      errorMessage: 'boom', failedStage: 'synthesis', result: null,
    } as unknown as AgenticJob;
    expect(callbackPayload(job)).toMatchObject({ failedStage: 'synthesis' });
  });
});
