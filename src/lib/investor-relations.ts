import { searchWeb, type WebSearchResult } from './search/web-search';

export interface InvestorRelationsFundamentals {
  fundamentals: Record<string, number>;
  sourceUrl: string;
  sourceName: string;
  evidenceSnippet: string;
}

const XBRL_METRICS: Record<string, string> = {
  'us-gaap:Revenues': 'revenue',
  'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax': 'revenue',
  'us-gaap:GrossProfit': 'gross_profit',
  'us-gaap:OperatingIncomeLoss': 'operating_income',
  'us-gaap:NetCashProvidedByUsedInOperatingActivities': 'operating_cash_flow',
  'us-gaap:PaymentsToAcquirePropertyPlantAndEquipment': 'capital_expenditure',
  'us-gaap:CashAndCashEquivalentsAtCarryingValue': 'cash_and_equivalents',
  'us-gaap:LongTermDebt': 'total_debt',
  'us-gaap:LongTermDebtNoncurrent': 'total_debt',
  'us-gaap:StockholdersEquity': 'total_equity',
  'us-gaap:StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest': 'total_equity',
  'us-gaap:InterestExpenseNonoperating': 'interest_expense',
  'us-gaap:NetIncomeLoss': 'net_income',
  'dei:EntityCommonStockSharesOutstanding': 'shares_outstanding',
};

function stripMarkup(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/,/g, '').trim();
}

function attributes(value: string): Record<string, string> {
  return Object.fromEntries([...value.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(([, key, item]) => [key.toLowerCase(), item]));
}

function scaledNumber(raw: string, attrs: Record<string, string>): number | null {
  const normalized = stripMarkup(raw).replace(/[()]/g, (character) => character === '(' ? '-' : '');
  const value = Number(normalized);
  const scale = attrs.scale == null ? 0 : Number(attrs.scale);
  if (!Number.isFinite(value) || !Number.isFinite(scale) || Math.abs(scale) > 12) return null;
  const signed = attrs.sign === '-' ? -Math.abs(value) : value;
  const result = signed * 10 ** scale;
  return Number.isFinite(result) ? result : null;
}

/**
 * Extracts values only from inline XBRL tags. Generic HTML tables are not
 * guessed because unit, period, and accounting meaning cannot be recovered
 * safely with regex. The returned values remain subject to the human DCF gate.
 */
export function extractInlineXbrlFundamentals(html: string, sourceUrl: string): InvestorRelationsFundamentals | null {
  const selections = new Map<string, number[]>();
  const tags = html.matchAll(/<ix:nonfraction\b([^>]*)>([\s\S]*?)<\/ix:nonfraction>/gi);
  for (const [, rawAttributes, rawValue] of tags) {
    const attrs = attributes(rawAttributes);
    const metric = attrs.name ? XBRL_METRICS[attrs.name] : undefined;
    const value = scaledNumber(rawValue, attrs);
    if (!metric || value == null) continue;
    const existing = selections.get(metric) ?? [];
    existing.push(value);
    selections.set(metric, existing);
  }
  if (!selections.size) return null;
  const fundamentals: Record<string, number> = {};
  for (const [metric, values] of selections) {
    // Annual values are usually larger than interim values. We retain the
    // largest absolute item and label the extraction for human confirmation.
    fundamentals[metric] = values.sort((left, right) => Math.abs(right) - Math.abs(left))[0];
  }
  if (fundamentals.operating_cash_flow != null && fundamentals.capital_expenditure != null) {
    fundamentals.free_cash_flow = fundamentals.operating_cash_flow - Math.abs(fundamentals.capital_expenditure);
  }
  return {
    fundamentals,
    sourceUrl,
    sourceName: 'Investor relations / regulatory inline XBRL filing',
    evidenceSnippet: 'Values were deterministically extracted from inline XBRL tags. Confirm annual period, units, and accounting scope before running a valuation.',
  };
}

function safeExternalUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || /^127\.|^10\.|^192\.168\.|^169\.254\./.test(host)) return null;
    if (url.port && url.port !== '443' && url.port !== '80') return null;
    return url;
  } catch {
    return null;
  }
}

function looksLikeFiling(result: WebSearchResult): boolean {
  return /annual report|10-k|10 k|financial statements|investor relations|inline xbrl|sec filing/i.test(`${result.title} ${result.snippet}`);
}

async function fetchHtml(url: URL): Promise<string | null> {
  const response = await fetch(url, {
    headers: { accept: 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8' },
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return null;
  const type = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!type.includes('html') && !type.includes('text/plain')) return null;
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > 4 * 1024 * 1024) return null;
  const text = await response.text();
  return text.length <= 4 * 1024 * 1024 ? text : null;
}

export async function retrieveInvestorRelationsFundamentals(companyName: string, ticker: string) {
  const search = await searchWeb(`${companyName} ${ticker} investor relations annual report 10-K financial statements`);
  const candidates = search.results.filter(looksLikeFiling).slice(0, 5);
  const skipped = search.results.filter((result) => /\.pdf(?:$|[?#])/i.test(result.url)).length;
  for (const candidate of candidates) {
    const url = safeExternalUrl(candidate.url);
    if (!url) continue;
    const html = await fetchHtml(url);
    if (!html) continue;
    const extracted = extractInlineXbrlFundamentals(html, url.toString());
    if (extracted) return { extracted, searchProvider: search.provider, skippedPdfCount: skipped };
  }
  return { extracted: null, searchProvider: search.provider, skippedPdfCount: skipped };
}
