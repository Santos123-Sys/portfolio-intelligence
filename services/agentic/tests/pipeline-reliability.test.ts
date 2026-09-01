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

describe('schema failures name the field that failed', () => {
  // A live discovery run failed with "the response could not be parsed or
  // validated", which is true and useless: the ZodError naming the exact field
  // was discarded by the provider-error catch-all. These pin that it is not.
  const discoveryRequest = {
    thesis: { versionId: thesisVersionId, criteria: thesis },
    portfolios: [{
      id: portfolioId,
      name: 'Swiss quality',
      role: 'swiss_quality' as const,
      baseCurrency: 'CHF',
      investmentObjective: 'Capital preservation',
    }],
    universe: [{
      ticker: 'NESN', exchange: 'XSWX', companyName: 'Nestle S.A.', currency: 'CHF',
      country: 'CH', sector: null, industry: null,
      assetType: 'Common Stock', observedAt: '2026-08-25T00:00:00.000Z',
      provider: 'eodhd', sourceUrl: 'https://example.test/universe/nesn',
      attributes: {},
    }],
    maxCandidatesPerPortfolio: 3,
  };

  function clientReturning(parsed: unknown): OpenAI {
    return { responses: { parse: async () => ({ output_parsed: parsed, output: [] }) } } as unknown as OpenAI;
  }

  it('names the offending field instead of a generic parse message', async () => {
    // A non-UUID portfolioId: shape-valid, so structured outputs accept it,
    // and only our own .uuid() refinement rejects it afterwards.
    const pipeline = new OpenAIAgenticPipeline('k', 'gpt-5.6', 'medium', clientReturning({
      marketMandates: [{
        portfolioId: 'not-a-uuid',
        role: 'swiss_quality',
        exchanges: ['XSWX'],
        currency: 'CHF',
        rationale: 'because',
      }],
      candidates: [],
      limitations: [],
    }));

    const failure = await pipeline.discoverSecurities(discoveryRequest as never).catch((e) => e);
    expect(failure).toBeInstanceOf(AgenticPipelineError);
    expect(failure.stage).toBe('discovery');
    expect(failure.retriable).toBe(true);
    expect(failure.message).toMatch(/portfolioId/);
    expect(failure.message).not.toMatch(/could not be parsed or validated/);
  });

  it('does not ask the model for thesisVersion, and supplies it itself', async () => {
    // The model omits thesisVersion entirely; the service injects the value it
    // already owns, so this must not be a schema failure.
    const pipeline = new OpenAIAgenticPipeline('k', 'gpt-5.6', 'medium', clientReturning({
      marketMandates: [{
        portfolioId,
        role: 'swiss_quality',
        exchanges: ['XSWX'],
        currency: 'CHF',
        rationale: 'Matches the confirmed mandate.',
      }],
      candidates: [],
      limitations: ['Universe is unranked.'],
    }));

    const output = await pipeline.discoverSecurities(discoveryRequest as never);
    expect(output.thesisVersion).toBe(thesis.version);
  });

  it('pins mandate identity to the trusted portfolio when the thesis source is unspecified', async () => {
    const requestWithUnspecifiedSource = {
      ...discoveryRequest,
      thesis: {
        ...discoveryRequest.thesis,
        criteria: {
          ...discoveryRequest.thesis.criteria,
          portfolios: discoveryRequest.thesis.criteria.portfolios.map((mandate) => ({
            ...mandate,
            currency: mandate.role === 'swiss_quality' ? 'Unspecified' : mandate.currency,
          })),
        },
      },
    };
    const pipeline = new OpenAIAgenticPipeline('k', 'gpt-5.6', 'medium', clientReturning({
      marketMandates: [{
        portfolioId,
        role: 'brazilian_growth',
        exchanges: ['XSWX'],
        currency: 'Unspecified',
        rationale: 'Source currency was not specified.',
      }],
      candidates: [],
      limitations: ['Universe is unranked.'],
    }));

    const output = await pipeline.discoverSecurities(requestWithUnspecifiedSource as never);
    expect(output.marketMandates[0]).toMatchObject({
      portfolioId,
      role: 'swiss_quality',
      currency: 'CHF',
    });
    expect(output.limitations).toContain(
      'Confirmed swiss_quality thesis source lists currency as "Unspecified"; trusted portfolio currency CHF is used for mandate identity.'
    );
  });

  it('pins a selected candidate to the trusted provider-universe identity', async () => {
    const abbRequest = {
      ...discoveryRequest,
      universe: [{
        ...discoveryRequest.universe[0],
        ticker: 'ABBN',
        companyName: 'ABB Ltd.',
        country: 'CH',
        sector: null,
        sourceUrl: 'https://example.test/universe/abbn',
      }],
    };
    const pipeline = new OpenAIAgenticPipeline('k', 'gpt-5.6', 'medium', clientReturning({
      marketMandates: [{
        portfolioId,
        role: 'swiss_quality',
        exchanges: ['XSWX'],
        currency: 'CHF',
        rationale: 'Matches the confirmed mandate.',
      }],
      candidates: [{
        portfolioId,
        ticker: 'ABBN',
        exchange: 'XSWX',
        companyName: 'ABB Limited',
        currency: 'Swiss franc',
        country: 'Switzerland',
        sector: 'Industrials',
        thesisAlignmentScore: 80,
        rationale: 'The supplied evidence supports the quality mandate.',
        matchedCriteria: ['Established competitive position'],
        violatedCriteria: [],
        groundedIn: ['identity:ticker'],
        sourceUrls: ['https://example.test/universe/abbn'],
        informationGaps: ['Sector is absent from the structured universe.'],
      }],
      limitations: [],
    }));

    const output = await pipeline.discoverSecurities(abbRequest as never);

    expect(output.candidates[0]).toMatchObject({
      ticker: 'ABBN',
      exchange: 'XSWX',
      companyName: 'ABB Ltd.',
      currency: 'CHF',
      country: 'CH',
      sector: null,
    });
  });
});
