import { describe, expect, it, vi } from 'vitest';
import { researchUniverse } from '../src/research-universe.js';

describe('bounded company research', () => {
  it('caps concurrent searches and reuses recent public evidence across runs', async () => {
    let active = 0;
    let peak = 0;
    const search = vi.fn(async (name: string, ticker: string) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 3));
      active--;
      return { query: name, urls: [`https://example.org/${ticker}`], snippets: ['Evidence'] };
    });
    const records = Array.from({ length: 5 }, (_, i) => ({
      companyName: `Company ${i}`, ticker: `CACHE${i}`, exchange: 'XSWX',
    }));
    const progress: number[] = [];
    const config = { provider: 'tavily' as const, apiKey: 'test' };
    await researchUniverse(records, config, async (done) => { progress.push(done); }, search, 0);
    expect(peak).toBeLessThanOrEqual(2);
    expect(progress).toEqual([1, 2, 3, 4, 5]);
    await researchUniverse(records, config, async () => {}, search, 0);
    expect(search).toHaveBeenCalledTimes(5);
  });
});
