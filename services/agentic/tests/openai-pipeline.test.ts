import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { OpenAIAgenticPipeline } from '../src/openai-pipeline.js';

describe('single OpenAI pipeline adapter', () => {
  it('normalizes structured metric pairs and preserves the caller thesis version', async () => {
    const fakeClient = {
      responses: {
        parse: async () => ({
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
        }),
      },
    } as unknown as OpenAI;
    const pipeline = new OpenAIAgenticPipeline('unused-test-key', 'gpt-5.6', 'medium', fakeClient);
    const result = await pipeline.extractThesis({
      version: 3,
      fileName: 'thesis.txt',
      mimeType: 'text/plain',
      contentBase64: Buffer.from('Swiss quality thesis').toString('base64'),
    });
    expect(result.criteria.version).toBe(3);
    expect(result.criteria.portfolios[0].targetMetrics).toEqual({ 'maximum weight': '15%' });
  });
});
