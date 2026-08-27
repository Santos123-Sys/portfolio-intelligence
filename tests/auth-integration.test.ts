import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';
import { buildContentSecurityPolicy } from '../src/lib/content-security-policy';
import { assertStrongPassword, hashPassword, passwordNeedsRehash, verifyPassword } from '../src/lib/password';
import { digestSessionPayload, signSessionPayload, verifySessionToken } from '../src/lib/session-token';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  findRecoveryCodeIndex,
  generateRecoveryCodes,
  hashRecoveryCode,
  totpCodeAt,
  verifyTotpCode,
} from '../src/lib/totp';
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
    await expect(hashPassword('too-short')).rejects.toThrow(/15 characters/);
    expect(() => assertStrongPassword('passwordpassword')).toThrow(/less common/);
    expect(() => assertStrongPassword('x'.repeat(129))).toThrow(/at most 128/);
  });

  it('uses the current scrypt work factor and rejects hostile encoded parameters', async () => {
    const encoded = await hashPassword('a long and unique passphrase');
    expect(passwordNeedsRehash(encoded)).toBe(false);
    expect(passwordNeedsRehash(encoded.replace('$131072$', '$16384$'))).toBe(true);
    expect(await verifyPassword('a long and unique passphrase', encoded.replace('$131072$', '$1073741824$'))).toBe(false);
  });

  it('signs, verifies and detects tampering in session tokens', async () => {
    const secret = '12345678901234567890123456789012';
    const payload = `550e8400-e29b-41d4-a716-446655440000.${Date.now() + 60_000}.${'n'.repeat(43)}`;
    const token = await signSessionPayload(payload, secret);
    expect((await verifySessionToken(token, secret))?.sessionId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(await verifySessionToken(`${token.slice(0, -1)}x`, secret)).toBeNull();
    expect(await digestSessionPayload(payload)).not.toBe(payload);
  });
});

describe('multi-factor authentication primitives', () => {
  const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const encryptionKey = 'a-separate-encryption-secret-that-is-long-enough';

  it('generates and verifies standard time-based codes without replay', () => {
    expect(totpCodeAt(rfcSecret, 0)).toBe('755224');
    expect(totpCodeAt(rfcSecret, 30_000)).toBe('287082');
    expect(verifyTotpCode(rfcSecret, '287082', { timeMs: 30_000, window: 0 })).toBe(1);
    expect(verifyTotpCode(rfcSecret, '287082', { timeMs: 30_000, window: 0, minimumStep: 1 })).toBeNull();
  });

  it('encrypts authenticator seeds and detects ciphertext tampering', () => {
    const encrypted = encryptTotpSecret(rfcSecret, encryptionKey);
    expect(encrypted).not.toContain(rfcSecret);
    expect(decryptTotpSecret(encrypted, encryptionKey)).toBe(rfcSecret);
    const parts = encrypted.split('.');
    parts[2] = `${parts[2].startsWith('A') ? 'B' : 'A'}${parts[2].slice(1)}`;
    const tampered = parts.join('.');
    expect(() => decryptTotpSecret(tampered, encryptionKey)).toThrow();
  });

  it('stores only one-way recovery-code digests', () => {
    const codes = generateRecoveryCodes(3);
    const hashes = codes.map((code) => hashRecoveryCode(code, encryptionKey));
    expect(hashes.join(' ')).not.toContain(codes[0]);
    expect(findRecoveryCodeIndex(codes[1].toLowerCase(), hashes, encryptionKey)).toBe(1);
    expect(findRecoveryCodeIndex('AAAA-BBBB-CCCC', hashes, encryptionKey)).toBeNull();
  });
});

describe('browser security policy', () => {
  it('sets CSP, anti-framing, MIME-sniffing and privacy headers globally', async () => {
    const rules = await nextConfig.headers?.();
    const headers = new Map(rules?.find((rule) => rule.source === '/:path*')?.headers.map((header) => [header.key, header.value]));
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it('builds a nonce-based production CSP without inline script permission', () => {
    const policy = buildContentSecurityPolicy('0123456789abcdef0123456789abcdef', true);
    expect(policy).toContain("script-src 'self' 'nonce-0123456789abcdef0123456789abcdef' 'strict-dynamic'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
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
      groundingBundles: [{
        portfolioId: '550e8400-e29b-41d4-a716-446655440000',
        bundle: {
          ticker: 'NESN',
          companyName: 'Nestle',
          exchange: 'XSWX',
          currency: 'CHF',
          sector: 'Consumer staples',
          country: 'CH',
          computedMetrics: { 'position:weight:position-1': 0.12 },
          dataAsOf: '2026-08-26T00:00:00.000Z',
          fundamentals: { 'fundamental:free_cash_flow:observation-1': 12.3 },
        },
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
