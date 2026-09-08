import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultGovernancePolicy } from '../src/lib/governance';

const route = readFileSync('src/app/api/governance/route.ts', 'utf8');
const dashboard = readFileSync('src/components/governance-dashboard.tsx', 'utf8');
const governance = readFileSync('src/lib/governance.ts', 'utf8');

describe('investment governance controls', () => {
  it('uses transparent review guardrails rather than autonomous trading thresholds', () => {
    expect(defaultGovernancePolicy).toMatchObject({
      maxPositionWeight: 0.15,
      maxSectorWeight: 0.35,
      maxCountryWeight: 0.4,
      minimumHoldings: 5,
    });
    expect(governance).toContain('not an autonomous trading system');
    expect(dashboard).toContain('not automated trading instructions');
  });

  it('keeps policy persistence owner-scoped and mutation-protected', () => {
    expect(route).toContain('authenticateRequest(req)');
    expect(route).toContain('assertSameOrigin(req)');
    expect(route).toContain('saveGovernancePolicy(session.auth.userId');
  });

  it('surfaces freshness, provider health, committee memos, attribution, and explicit monitoring gaps', () => {
    expect(dashboard).toContain('Evidence freshness');
    expect(dashboard).toContain('Provider health');
    expect(dashboard).toContain('Investment committee memos');
    expect(dashboard).toContain('Return contribution');
    expect(governance).toContain('Earnings, leverage, management events');
    expect(governance).toContain('not_connected');
  });
});
