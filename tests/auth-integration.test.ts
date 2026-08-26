import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/password';
import { digestSessionPayload, signSessionPayload, verifySessionToken } from '../src/lib/session-token';
import { externalAgenticUrl, manifestHash } from '../src/lib/integrations/agentic-adapter';
import { AgenticRunRequest, type PortfolioAnalysisManifest } from '../src/lib/integrations/agentic-contract';

describe('dashboard authentication primitives', () => {
  it('hashes and verifies a password without storing the original', async () => {
    const password = 'correct-horse-battery-staple';
    const encoded = await hashPassword(password);
    expect(encoded).not.toContain(password);
    expect(await verifyPassword(password, encoded)).toBe(true);
    expect(await verifyPassword('incorrect-password-value', encoded)).toBe(false);
  });

  it('rejects short passwords', async () => {
    await expect(hashPassword('too-short')).rejects.toThrow(/12 characters/);
  });

  it('signs, verifies and detects tampering in session tokens', async () => {
    const secret = '12345678901234567890123456789012';
    const payload = `550e8400-e29b-41d4-a716-446655440000.${Date.now() + 60_000}.nonce`;
    const token = await signSessionPayload(payload, secret);
    expect((await verifySessionToken(token, secret))?.sessionId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(await verifySessionToken(`${token.slice(0, -1)}x`, secret)).toBeNull();
    expect(await digestSessionPayload(payload)).not.toBe(payload);
  });
});

describe('external agentic integration contract', () => {
  it('accepts the dashboard run-request shape', () => {
    const parsed = AgenticRunRequest.parse({
      thesis: {
        versionId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        criteria: {
          version: 1,
          portfolios: [{
            role: 'swiss_quality',
            currency: 'CHF',
            objective: 'Stable compounding',
            inclusionCriteria: ['Durable moat'],
            exclusionCriteria: ['Financial distress'],
          }],
          globalConstraints: ['No leverage'],
        },
      },
      securities: [{
        ticker: 'NESN',
        exchange: 'XSWX',
        portfolioId: '550e8400-e29b-41d4-a716-446655440000',
      }],
      portfolios: [{
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Swiss Quality',
        baseCurrency: 'CHF',
        investmentObjective: 'Stable compounding',
      }],
    });
    expect(parsed.securities[0].exchange).toBe('XSWX');
  });

  it('builds private Railway URLs without losing the base path', () => {
    expect(externalAgenticUrl('http://agentic-system.railway.internal:8080', '/v1/analysis-runs'))
      .toBe('http://agentic-system.railway.internal:8080/v1/analysis-runs');
  });

  it('changes the idempotency hash when a manifest changes', () => {
    const manifest = {
      schemaVersion: '1.0',
      generatedAt: '2026-08-26T12:00:00.000Z',
      thesisVersion: 1,
      portfolios: [],
    } as unknown as PortfolioAnalysisManifest;
    expect(manifestHash(manifest)).not.toBe(manifestHash({ ...manifest, thesisVersion: 2 }));
  });
});
