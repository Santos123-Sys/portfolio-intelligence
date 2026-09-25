import { searchWeb, type WebSearchResult } from './search/web-search';

export interface InvestorRelationsFundamentals {
  fundamentals: Record<string, number>;
  currency: string;
  periodEnd: string;
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
  'us-gaap:IncomeTaxExpenseBenefit': 'income_tax_expense',
  'us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest': 'pre_tax_income',
  'us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments': 'pre_tax_income',
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

/** Only a single explicit, annual, unsegmented reporting period may be imported. */
export function extractInlineXbrlFundamentals(html: string, sourceUrl: string, expectedCurrency?: string): InvestorRelationsFundamentals | null {
  const contexts = new Map<string, { end: string; annual: boolean; instant: boolean }>();
  for (const [, rawAttrs, body] of html.matchAll(/<(?:xbrli:)?context\b([^>]*)>([\s\S]*?)<\/(?:xbrli:)?context>/gi)) {
    const id = attributes(rawAttrs).id;
    const start = body.match(/<(?:xbrli:)?startDate>(\d{4}-\d{2}-\d{2})<\/(?:xbrli:)?startDate>/i)?.[1];
    const end = body.match(/<(?:xbrli:)?endDate>(\d{4}-\d{2}-\d{2})<\/(?:xbrli:)?endDate>/i)?.[1]
      ?? body.match(/<(?:xbrli:)?instant>(\d{4}-\d{2}-\d{2})<\/(?:xbrli:)?instant>/i)?.[1];
    if (!id || !end || /<(?:xbrli:)?(?:segment|scenario)\b/i.test(body)) continue;
    const days = start ? (Date.parse(end) - Date.parse(start)) / 86_400_000 : NaN;
    contexts.set(id, { end, annual: days >= 330 && days <= 380, instant: !start });
  }
  const units = new Map<string, string>();
  for (const [, rawAttrs, body] of html.matchAll(/<(?:xbrli:)?unit\b([^>]*)>([\s\S]*?)<\/(?:xbrli:)?unit>/gi)) {
    const id = attributes(rawAttrs).id;
    const measure = body.match(/<(?:xbrli:)?measure>\s*(?:iso4217:|xbrli:)?([A-Z]{3}|shares)\s*<\/(?:xbrli:)?measure>/i)?.[1];
    if (id && measure) units.set(id, measure.toUpperCase());
  }
  const selections: Array<{ metric: string; value: number; end: string; annual: boolean; instant: boolean; currency: string }> = [];
  const tags = html.matchAll(/<ix:nonfraction\b([^>]*)>([\s\S]*?)<\/ix:nonfraction>/gi);
  for (const [, rawAttributes, rawValue] of tags) {
    const attrs = attributes(rawAttributes);
    const metric = attrs.name ? XBRL_METRICS[attrs.name] : undefined;
    const value = scaledNumber(rawValue, attrs);
    const context = contexts.get(attrs.contextref);
    const unit = units.get(attrs.unitref);
    if (!metric || value == null || !context || !unit || (!context.annual && !context.instant)) continue;
    if (metric === 'shares_outstanding' ? unit !== 'SHARES' : unit === 'SHARES') continue;
    if (expectedCurrency && unit !== 'SHARES' && unit !== expectedCurrency.toUpperCase()) continue;
    selections.push({ metric, value, ...context, currency: unit });
  }
  const annual = selections.filter((item) => item.annual && item.currency !== 'SHARES');
  if (!annual.length) return null;
  const periodEnd = annual.map((item) => item.end).sort().at(-1)!;
  // Resolve the currency explicitly; a mixed-currency report cannot be imported.
  const currencies = [...new Set(annual.filter((item) => item.end === periodEnd).map((item) => item.currency))];
  const selectedCurrency = expectedCurrency?.toUpperCase() ?? (currencies.length === 1 ? currencies[0] : null);
  if (!selectedCurrency || !currencies.includes(selectedCurrency)) return null;
  const fundamentals: Record<string, number> = {};
  const ambiguous = new Set<string>();
  for (const item of selections) {
    if (item.end !== periodEnd || (item.currency !== selectedCurrency && item.currency !== 'SHARES')) continue;
    if (item.currency === 'SHARES' ? !item.instant : !item.annual && !item.instant) continue;
    if (fundamentals[item.metric] != null && fundamentals[item.metric] !== item.value) ambiguous.add(item.metric);
    else fundamentals[item.metric] = item.value;
  }
  for (const metric of ambiguous) delete fundamentals[metric];
  if (!Object.keys(fundamentals).length) return null;
  if (fundamentals.operating_cash_flow != null && fundamentals.capital_expenditure != null) {
    fundamentals.free_cash_flow = fundamentals.operating_cash_flow - Math.abs(fundamentals.capital_expenditure);
  }
  return {
    fundamentals,
    currency: selectedCurrency,
    periodEnd,
    sourceUrl,
    sourceName: 'Investor relations / regulatory inline XBRL filing',
    evidenceSnippet: `Unsegmented annual reporting period ending ${periodEnd}; currency ${selectedCurrency}. Conflicting metric values were excluded. Confirm accounting scope before valuation.`,
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

export async function retrieveInvestorRelationsFundamentals(companyName: string, ticker: string, expectedCurrency?: string) {
  const search = await searchWeb(`${companyName} ${ticker} investor relations annual report 10-K financial statements`);
  const candidates = search.results.filter(looksLikeFiling).slice(0, 5);
  const skipped = search.results.filter((result) => /\.pdf(?:$|[?#])/i.test(result.url)).length;
  for (const candidate of candidates) {
    const url = safeExternalUrl(candidate.url);
    if (!url) continue;
    const html = await fetchHtml(url);
    if (!html) continue;
    const extracted = extractInlineXbrlFundamentals(html, url.toString(), expectedCurrency);
    if (extracted) return { extracted, searchProvider: search.provider, skippedPdfCount: skipped };
  }
  return { extracted: null, searchProvider: search.provider, skippedPdfCount: skipped };
}
