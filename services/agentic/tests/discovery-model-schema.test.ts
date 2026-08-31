import { describe, expect, it } from 'vitest';
import { zodTextFormat } from 'openai/helpers/zod';
import {
  AnalysisOutput,
  DiscoveryCandidate,
  MarketDiscoveryOutput,
  ReportSynthesisOutput,
} from '@portfolio-intelligence/agentic-contract';
import { MarketDiscoveryModelOutput } from '../src/openai-pipeline.js';

/**
 * Discovery failed on every run with "the response could not be parsed or
 * validated". There was no response: zodTextFormat rejected the schema while
 * building the request, because DiscoveryCandidate uses .trim(), a
 * value-changing check that strict Structured Outputs cannot express.
 *
 * These tests exist so that failure cannot come back silently.
 */
describe('agent schemas are expressible as strict Structured Outputs', () => {
  it('accepts the discovery schema the model is actually given', () => {
    expect(() => zodTextFormat(MarketDiscoveryModelOutput, 'market_discovery')).not.toThrow();
  });

  it('still rejects the contract schema — which is why the model one exists', () => {
    // If this ever stops throwing, the contract dropped .trim() and the derived
    // schema is redundant. That is worth noticing rather than carrying forever.
    expect(() =>
      zodTextFormat(MarketDiscoveryOutput.omit({ verifiedWebSources: true, thesisVersion: true }), 'x')
    ).toThrow(/cannot be represented by strict Structured Outputs/);
  });

  it('keeps the other two agents expressible', () => {
    expect(() => zodTextFormat(AnalysisOutput, 'security_analysis')).not.toThrow();
    expect(() => zodTextFormat(ReportSynthesisOutput, 'portfolio_synthesis')).not.toThrow();
  });
});

describe('the derived candidate schema does not drift from the contract', () => {
  it('carries exactly the contract candidate keys', () => {
    const contractKeys = Object.keys(DiscoveryCandidate.shape).sort();
    const modelKeys = Object.keys(
      (MarketDiscoveryModelOutput.shape.candidates.element as typeof DiscoveryCandidate).shape
    ).sort();
    expect(modelKeys).toEqual(contractKeys);
  });

  it('omits only the two fields the service supplies itself', () => {
    const contractKeys = Object.keys(MarketDiscoveryOutput.shape).sort();
    const modelKeys = Object.keys(MarketDiscoveryModelOutput.shape).sort();
    expect(contractKeys.filter((k) => !modelKeys.includes(k))).toEqual([
      'thesisVersion',
      'verifiedWebSources',
    ]);
  });

  it('produces output the strict contract still accepts', () => {
    // The model schema is looser on purpose; the contract remains the gate.
    const candidate = {
      portfolioId: '550e8400-e29b-41d4-a716-446655440000',
      ticker: '  NESN  ',
      exchange: 'XSWX',
      companyName: 'Nestle S.A.',
      currency: 'CHF',
      country: 'CH',
      sector: null,
      thesisAlignmentScore: 80,
      rationale: 'Meets the stated inclusion criteria.',
      matchedCriteria: ['Listed on SIX'],
      violatedCriteria: [],
      groundedIn: ['identity:ticker'],
      sourceUrls: ['https://example.test/nesn'],
      informationGaps: [],
    };
    expect(() => MarketDiscoveryModelOutput.shape.candidates.element.parse(candidate)).not.toThrow();
    // And the contract normalises what the model schema let through.
    expect(DiscoveryCandidate.parse(candidate).ticker).toBe('NESN');
  });
});
