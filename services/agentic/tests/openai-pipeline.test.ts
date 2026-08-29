import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { AGENT_REASONING_PROMPTS } from '@portfolio-intelligence/agentic-contract';
import { OpenAIAgenticPipeline } from '../src/openai-pipeline.js';

describe('single OpenAI pipeline adapter', () => {
  it('normalizes structured metric pairs and preserves the caller thesis version', async () => {
    let capturedInstructions = '';
    const fakeClient = {
      responses: {
        parse: async (request: { instructions?: string }) => {
          capturedInstructions = request.instructions ?? '';
          return ({
            output_parsed: {
              criteria: {
                version: 999,
                portfolios: [{
                  role: 'swiss_quality',
                  currency: 'CHF',
                  objective: 'Stable compounding',
                  inclusionCriteria: ['Durable moat'],
                  exclusionCriteria: [],
                  targetMetrics: [{ name: 'maximum weight', value: '15%' }],
                }],
                globalConstraints: [],
              },
              extractionConfidence: 0.8,
              ambiguousPoints: [],
              unmappedContent: [],
            },
          });
        },
      },
    } as unknown as OpenAI;
    const pipeline = new OpenAIAgenticPipeline('unused-test-key', 'gpt-5.6', 'medium', fakeClient);
    const result = await pipeline.extractThesis(
      {
        version: 3,
        fileName: 'thesis.txt',
        mimeType: 'text/plain',
        contentBase64: Buffer.from('Swiss quality thesis').toString('base64'),
      },
      {
        agentKind: 'thesis_extraction',
        configVersion: 2,
        name: 'Owner thesis analyst',
        scope: 'Emphasize the investor-authored mandate.',
        promptAddendum: 'Call out dated constraints.',
        enabledTools: ['thesis_document'],
      }
    );
    expect(result.criteria.version).toBe(3);
    expect(result.criteria.portfolios[0].targetMetrics).toEqual({ 'maximum weight': '15%' });
    expect(capturedInstructions).toContain(AGENT_REASONING_PROMPTS.thesis_extraction.systemPrompt);
    expect(capturedInstructions.indexOf('SOURCE-DERIVED REASONING POLICY')).toBeLessThan(
      capturedInstructions.indexOf('OWNER-CONFIGURED SCOPE')
    );
    expect(capturedInstructions.indexOf('OWNER-CONFIGURED SCOPE')).toBeLessThan(
      capturedInstructions.indexOf('OWNER PROMPT ADDENDUM')
    );
  });
});
