import { afterEach, describe, expect, it, vi } from 'vitest';
import { researchCompany } from '../src/web-research.js';

afterEach(() => vi.unstubAllGlobals());

describe('bounded web research', () => {
  it('retries a transient 429 and keeps verified source metadata', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ url: 'https://example.org/report', content: 'Source facts' }] }) });
    vi.stubGlobal('fetch', fetcher);
    const result = await researchCompany('Example', 'EX', { provider: 'tavily', apiKey: 'test' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(result.urls).toEqual(['https://example.org/report']);
  });

  it('does not repeat invalid provider requests', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    vi.stubGlobal('fetch', fetcher);
    await expect(researchCompany('Example', 'EX', { provider: 'brave', apiKey: 'test' })).rejects.toThrow('rejected the request (403)');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
