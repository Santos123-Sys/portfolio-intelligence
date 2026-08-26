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
