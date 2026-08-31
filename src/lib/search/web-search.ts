import { getEnv } from '../env';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  provider: string;
  query: string;
  results: WebSearchResult[];
  rawPayload: unknown;
}

export async function searchWeb(query: string, count = 5): Promise<WebSearchResponse> {
  const env = getEnv();
  if (env.WEB_SEARCH_PROVIDER === 'tavily') {
    if (!env.WEB_SEARCH_API_KEY) throw new Error('WEB_SEARCH_API_KEY is required for Tavily Search');
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${env.WEB_SEARCH_API_KEY}` },
      body: JSON.stringify({ query, max_results: Math.max(1, Math.min(count, 10)), search_depth: 'basic', include_answer: false, include_raw_content: false }),
    });
    if (!res.ok) throw new Error(`Tavily Search failed: ${res.status} ${res.statusText}`);
    const raw = await res.json();
    const results = Array.isArray(raw?.results) ? raw.results : [];
    return {
      provider: 'tavily-search',
      query,
      results: results.map((r: any) => ({
        title: String(r.title ?? ''),
        url: String(r.url ?? ''),
        snippet: String(r.content ?? ''),
      })),
      rawPayload: raw,
    };
  }
  if (env.WEB_SEARCH_PROVIDER !== 'brave') {
    throw new Error(`WEB_SEARCH_PROVIDER '${env.WEB_SEARCH_PROVIDER}' is not configured for live search`);
  }
  if (!env.WEB_SEARCH_API_KEY) throw new Error('WEB_SEARCH_API_KEY is required for Brave Search');

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(count));
  url.searchParams.set('search_lang', 'en');
  url.searchParams.set('country', 'US');
  url.searchParams.set('safesearch', 'moderate');

  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      'x-subscription-token': env.WEB_SEARCH_API_KEY,
    },
  });
  if (!res.ok) throw new Error(`Brave Search failed: ${res.status} ${res.statusText}`);

  const raw = await res.json();
  const web = Array.isArray(raw?.web?.results) ? raw.web.results : [];
  return {
    provider: 'brave-search',
    query,
    results: web.map((r: any) => ({
      title: String(r.title ?? ''),
      url: String(r.url ?? ''),
      snippet: String(r.description ?? ''),
    })),
    rawPayload: raw,
  };
}
