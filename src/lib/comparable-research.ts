import { getPriceProvider } from './connectors';
import { retrieveInvestorRelationsFundamentals } from './investor-relations';
import { searchWeb, type WebSearchResult } from './search/web-search';

export interface ComparablePeerIdentity {
  companyName: string;
  ticker: string;
  exchange: string;
  currency: string;
}

export interface ComparablePeerResearch extends ComparablePeerIdentity {
  marketCapitalization?: number;
  netDebt?: number;
  totalDebt?: number;
  revenue?: number;
  ebitda?: number;
  netIncome?: number;
  grossProfit?: number;
  operatingIncome?: number;
  totalEquity?: number;
  interestExpense?: number;
  ntmRevenue?: number;
  ntmEbitda?: number;
  ntmNetIncome?: number;
  sourceUrl?: string;
  forecastSourceUrl?: string;
  evidence: string[];
  gaps: string[];
}

export interface ComparablePeerSuggestion extends ComparablePeerIdentity {
  sourceUrl: string;
  rationale: string;
}

function exchangeFromText(text: string, fallback: string): string {
  if (/\b(?:SIX|SWX|XSWX)\b/i.test(text)) return 'XSWX';
  if (/\b(?:B3|BVMF|BM&F)\b/i.test(text)) return 'BVMF';
  if (/\b(?:NASDAQ|NYSE)\b/i.test(text)) return 'XNAS';
  if (/\bLSE\b/i.test(text)) return 'XLON';
  return fallback;
}

/**
 * Suggestions are accepted only when a public result writes a company and
 * ticker together. This avoids fabricating identities from a generic “top
 * competitors” list. A user still reviews every suggestion before valuation.
 */
export function extractComparableSuggestions(
  results: WebSearchResult[], target: ComparablePeerIdentity & { sector?: string | null }
): ComparablePeerSuggestion[] {
  const suggestions = new Map<string, ComparablePeerSuggestion>();
  for (const result of results) {
    const text = `${result.title} ${result.snippet}`;
    // Snippets generally carry the named relationship, while titles often
    // prepend generic words such as “Comparable companies”. Prefer snippets.
    const namedSource = result.snippet.match(/([A-Z][A-Za-z0-9&.,' -]{2,80})\s*\((?:NYSE|NASDAQ|SIX|B3|BVMF|LSE|XETRA)?\s*[:\-]?\s*([A-Z][A-Z0-9.-]{1,10})\)/)
      ?? result.title.match(/([A-Z][A-Za-z0-9&.,' -]{2,80})\s*\((?:NYSE|NASDAQ|SIX|B3|BVMF|LSE|XETRA)?\s*[:\-]?\s*([A-Z][A-Z0-9.-]{1,10})\)/);
    if (!namedSource) continue;
    const [, rawName, rawTicker] = namedSource;
    {
      const ticker = rawTicker.toUpperCase();
      if (ticker === target.ticker.toUpperCase() || suggestions.has(ticker)) continue;
      const companyName = rawName.trim();
      if (companyName.length < 3) continue;
      suggestions.set(ticker, {
        companyName,
        ticker,
        exchange: exchangeFromText(text, target.exchange),
        currency: target.currency,
        sourceUrl: result.url,
        rationale: `Public research result identifies ${companyName} (${ticker}) alongside the target in ${target.sector ?? 'the relevant'} coverage. Confirm business-model, size, growth, and corporate-action comparability before use.`,
      });
    }
  }
  return [...suggestions.values()].slice(0, 10);
}

export async function suggestComparablePeers(target: ComparablePeerIdentity & { sector?: string | null }) {
  const query = `${target.companyName} ${target.ticker} ${target.sector ?? ''} publicly traded competitors comparable companies ticker`;
  const search = await searchWeb(query, 10);
  return { query: search.query, provider: search.provider, peers: extractComparableSuggestions(search.results, target) };
}

function finite(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function labelledNumber(text: string, labels: string[]): number | undefined {
  for (const label of labels) {
    const match = text.match(new RegExp(`${label}[^0-9]{0,48}(-?[0-9][0-9,]*(?:\\.[0-9]+)?)\\s*(trillion|billion|million|bn|mn|m|b)?`, 'i'));
    if (!match?.[1]) continue;
    const base = Number(match[1].replaceAll(',', ''));
    if (!Number.isFinite(base)) continue;
    const suffix = match[2]?.toLowerCase();
    const multiplier = suffix === 'trillion' ? 1e12 : suffix === 'billion' || suffix === 'bn' || suffix === 'b' ? 1e9 : suffix === 'million' || suffix === 'mn' || suffix === 'm' ? 1e6 : 1;
    return base * multiplier;
  }
  return undefined;
}

/** Extract only figures whose snippet explicitly calls them a forecast, estimate, guidance, outlook, or consensus. */
export function extractForwardFigures(results: WebSearchResult[]) {
  const forecast = results.find((result) => /forecast|estimate|guidance|outlook|consensus/i.test(`${result.title} ${result.snippet}`));
  if (!forecast) return { source: undefined, values: {} as Record<string, number | undefined> };
  const text = `${forecast.title} ${forecast.snippet}`;
  return {
    source: forecast,
    values: {
      ntmRevenue: labelledNumber(text, ['forecast(?:ed)? revenue', 'revenue estimate', 'revenue guidance', 'revenue outlook']),
      ntmEbitda: labelledNumber(text, ['forecast(?:ed)? ebitda', 'ebitda estimate', 'ebitda guidance', 'ebitda outlook']),
      ntmNetIncome: labelledNumber(text, ['forecast(?:ed)? net income', 'net income estimate', 'earnings estimate']),
    },
  };
}

/**
 * Prefills comparable-company inputs from independently labelled primary filing
 * data, public web forecasts, and the configured market-data provider. A human
 * still owns the peer-selection decision and reviews all evidence.
 */
export async function researchComparablePeer(identity: ComparablePeerIdentity): Promise<ComparablePeerResearch> {
  const output: ComparablePeerResearch = { ...identity, evidence: [], gaps: [] };
  const query = `${identity.companyName} ${identity.ticker} forecast revenue EBITDA net income guidance outlook consensus`;
  const [filingResult, forecastSearch] = await Promise.allSettled([
    retrieveInvestorRelationsFundamentals(identity.companyName, identity.ticker),
    searchWeb(query, 5),
  ]);
  if (filingResult.status === 'fulfilled' && filingResult.value.extracted) {
    const filing = filingResult.value.extracted;
    output.revenue = filing.fundamentals.revenue;
    output.netIncome = filing.fundamentals.net_income;
    output.grossProfit = filing.fundamentals.gross_profit;
    output.operatingIncome = filing.fundamentals.operating_income;
    output.totalEquity = filing.fundamentals.total_equity;
    output.interestExpense = filing.fundamentals.interest_expense;
    const debt = filing.fundamentals.total_debt;
    const cash = filing.fundamentals.cash_and_equivalents;
    output.totalDebt = debt;
    if (debt != null && cash != null) output.netDebt = debt - cash;
    output.sourceUrl = filing.sourceUrl;
    output.evidence.push('Historical financials: primary investor-relations / regulatory filing.');
  } else output.gaps.push('No readable inline-XBRL annual-report or filing financials were found.');

  if (forecastSearch.status === 'fulfilled') {
    const extracted = extractForwardFigures(forecastSearch.value.results);
    if (extracted.source) {
      output.forecastSourceUrl = extracted.source.url;
      output.ntmRevenue = extracted.values.ntmRevenue;
      output.ntmEbitda = extracted.values.ntmEbitda;
      output.ntmNetIncome = extracted.values.ntmNetIncome;
      if (Object.values(extracted.values).some((value) => value != null)) output.evidence.push('Forward figures: public source snippet explicitly labelled as forecast, estimate, guidance, outlook, or consensus.');
      else output.gaps.push('A forward-data page was found, but no labelled forecast figure could be extracted safely.');
    } else output.gaps.push('No public, explicitly labelled forward revenue, EBITDA, or earnings figure was found.');
  } else output.gaps.push('Web search for forward estimates was unavailable.');

  try {
    const provider = getPriceProvider();
    if (provider.getFundamentals) {
      const fundamentals = await provider.getFundamentals(identity.ticker, identity.exchange);
      output.marketCapitalization ??= finite(fundamentals.market_capitalization);
      output.revenue ??= finite(fundamentals.revenue);
      output.ebitda ??= finite(fundamentals.ebitda);
      output.netIncome ??= finite(fundamentals.net_income);
      output.grossProfit ??= finite(fundamentals.gross_profit);
      output.operatingIncome ??= finite(fundamentals.operating_income);
      output.totalEquity ??= finite(fundamentals.total_equity);
      output.interestExpense ??= finite(fundamentals.interest_expense);
      const debt = finite(fundamentals.total_debt);
      const cash = finite(fundamentals.cash_and_equivalents);
      if (output.netDebt == null && debt != null && cash != null) output.netDebt = debt - cash;
      output.totalDebt ??= debt;
      output.sourceUrl ??= typeof fundamentals._sourceUrl === 'string' ? fundamentals._sourceUrl : undefined;
      if (output.marketCapitalization != null || output.ebitda != null) output.evidence.push(`Supplemental market/fundamental data: ${provider.name}.`);
    }
  } catch (error) {
    output.gaps.push(`Supplemental market-data lookup unavailable: ${(error as Error).message}`);
  }
  const missing = [['market capitalization', output.marketCapitalization], ['net debt', output.netDebt], ['LTM revenue', output.revenue], ['LTM EBITDA', output.ebitda], ['LTM net income', output.netIncome]]
    .filter(([, value]) => value == null).map(([label]) => label);
  if (missing.length) output.gaps.push(`Still missing: ${missing.join(', ')}.`);
  return output;
}
