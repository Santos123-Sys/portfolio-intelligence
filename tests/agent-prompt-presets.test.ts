import { describe, expect, it, vi } from 'vitest';
import {
  AGENT_REASONING_PROMPTS,
  AgentKind,
  DETERMINISTIC_ENGINE_POLICIES,
} from '@portfolio-intelligence/agentic-contract';
import { startDiscoveryAfterThesisConfirmation } from '../src/lib/thesis-discovery-transition';

describe('source-derived reasoning policies', () => {
  it('covers every configurable LLM agent and preserves the attached source mapping', () => {
    expect(Object.keys(AGENT_REASONING_PROMPTS).sort()).toEqual([...AgentKind.options].sort());
    expect(AGENT_REASONING_PROMPTS.thesis_extraction.sourceFile).toBe('04_thesis_extraction_agent_prompt.md');
    expect(AGENT_REASONING_PROMPTS.market_research.sourceFile).toBe('03_market_discovery_agent_prompt (1).md');
    expect(AGENT_REASONING_PROMPTS.security_analysis.sourceFile).toBe('01_financial_analysis_agent_prompt (2).md');
    expect(AGENT_REASONING_PROMPTS.market_research.systemPrompt).toContain('MISSING DATA IS NOT A FAILED SCREEN');
    expect(AGENT_REASONING_PROMPTS.security_analysis.systemPrompt).toContain('NO VALUATION OR ARITHMETIC');
  });

  it('keeps DCF and risk as deterministic engine policies rather than LLM agent kinds', () => {
    expect(DETERMINISTIC_ENGINE_POLICIES.map((policy) => policy.sourceFile)).toEqual([
      '02_dcf_prompt (1).md',
      '05_risk_engine_prompt.md',
    ]);
    expect(AgentKind.options).not.toContain('valuation_engine');
    expect(AgentKind.options).not.toContain('risk_engine');
  });
});

describe('confirmed-thesis discovery transition', () => {
  it('starts market research for the exact confirmed thesis after the human gate', async () => {
    const start = vi.fn(async () => ({
      run: { id: 'run-1', status: 'queued' },
      remote: null,
      reused: false as const,
    }));
    const result = await startDiscoveryAfterThesisConfirmation(
      { ownerId: 'owner-1', thesisVersionId: 'thesis-2' },
      start
    );
    expect(start).toHaveBeenCalledWith({
      ownerId: 'owner-1',
      thesisVersionId: 'thesis-2',
      maxCandidatesPerPortfolio: 6,
      reuseExistingForThesis: true,
    });
    expect(result).toEqual({ status: 'started', runId: 'run-1', runStatus: 'queued' });
  });

  it('returns a recoverable blocked transition when market-data prerequisites are absent', async () => {
    const start = vi.fn(async () => {
      throw new Error('Live discovery requires MARKET_DATA_PROVIDER=eodhd');
    });
    await expect(startDiscoveryAfterThesisConfirmation(
      { ownerId: 'owner-1', thesisVersionId: 'thesis-2' },
      start
    )).resolves.toEqual({
      status: 'blocked',
      errorMessage: 'Live discovery requires MARKET_DATA_PROVIDER=eodhd',
    });
  });
});
