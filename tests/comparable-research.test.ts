import { describe, expect, it } from 'vitest';
import { extractComparableSuggestions, extractForwardFigures } from '../src/lib/comparable-research';

describe('comparable web-research extraction', () => {
  it('retains only explicitly labelled forward figures', () => {
    const result = extractForwardFigures([{ title: 'Peer guidance', url: 'https://example.com/guidance', snippet: 'Revenue guidance: 1.4 billion. EBITDA estimate: 250 million.' }]);
    expect(result.values.ntmRevenue).toBe(1_400_000_000);
    expect(result.values.ntmEbitda).toBe(250_000_000);
  });

  it('suggests only peers with a publicly written company and ticker pair', () => {
    const peers = extractComparableSuggestions([{ title: 'Comparable companies', url: 'https://example.com/peers', snippet: 'Peer Holdings (SIX: PHLD) competes in the same sector.' }], { companyName: 'Target SA', ticker: 'TGT', exchange: 'XSWX', currency: 'CHF', sector: 'Industrials' });
    expect(peers).toHaveLength(1);
    expect(peers[0]).toMatchObject({ companyName: 'Peer Holdings', ticker: 'PHLD', exchange: 'XSWX' });
    expect(peers[0].rationale).toContain('Confirm business-model');
  });
});
