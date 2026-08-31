export interface WebResearchConfig {
  provider: 'none' | 'brave' | 'tavily';
  apiKey?: string;
}

export interface WebResearchEvidence {
  query: string;
  urls: string[];
  snippets: string[];
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }

/** Server-side qualitative evidence only: never a substitute for market data. */
export async function researchCompany(companyName: string, ticker: string, config: WebResearchConfig): Promise<WebResearchEvidence> {
  const query = `${companyName} ${ticker} business model strategy catalysts competitive advantage risks`;
  if (config.provider === 'none' || !config.apiKey) return { query, urls: [], snippets: [] };
  if (config.provider === 'tavily') {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ query, max_results: 3, search_depth: 'basic', include_answer: false, include_raw_content: false }),
    });
    if (!response.ok) throw new Error(`Tavily research request failed: ${response.status}`);
    const raw = record(await response.json());
    const rows: unknown[] = Array.isArray(raw.results) ? raw.results : [];
    return { query, urls: rows.map(record).map((row) => text(row.url)).filter(Boolean), snippets: rows.map(record).map((row) => text(row.content)).filter(Boolean) };
  }
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query); url.searchParams.set('count', '3');
  const response = await fetch(url, { headers: { accept: 'application/json', 'x-subscription-token': config.apiKey } });
  if (!response.ok) throw new Error(`Brave research request failed: ${response.status}`);
  const raw = record(await response.json());
  const searchResults = record(raw.web).results;
  const rows: unknown[] = Array.isArray(searchResults) ? searchResults : [];
  return { query, urls: rows.map(record).map((row) => text(row.url)).filter(Boolean), snippets: rows.map(record).map((row) => text(row.description)).filter(Boolean) };
}
