/**
 * Foreign exchange — the ONLY place in this codebase where currencies mix.
 *
 * ADR-002 in one sentence: risk and performance are computed per portfolio in
 * native currency and never blended; the sole exception is a display total on
 * the Overview page, converted live, which never feeds another figure.
 *
 * This module is deliberately isolated so that rule is enforceable by inspection.
 * If anything in src/lib/quant ever imports from here, the rule has been broken.
 *
 * Rate source: the European Central Bank's daily reference rates. Free, no API
 * key, no rate limit, published every working day around 16:00 CET, and it
 * covers both CHF and BRL. Portfolio Performance uses the same feed for exactly
 * this purpose.
 */

import { Currency } from '../quant/types';

const ECB_DAILY =
  'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

export interface FxRate {
  from: Currency;
  to: Currency;
  rate: number;
  rateDate: string;
  source: string;
}

/**
 * Fetch ECB daily reference rates. All ECB rates are quoted per 1 EUR, so a
 * CHF->BRL rate is derived by triangulating through EUR.
 */
export async function fetchEcbRates(): Promise<{
  rateDate: string;
  perEur: Record<string, number>;
}> {
  const res = await fetch(ECB_DAILY, { next: { revalidate: 3600 } });
  if (!res.ok) {
    throw new Error(`ECB fetch failed: ${res.status} ${res.statusText}`);
  }
  const xml = await res.text();

  const dateMatch = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/);
  if (!dateMatch) throw new Error('ECB response contained no rate date');
  const rateDate = dateMatch[1];

  const perEur: Record<string, number> = { EUR: 1 };
  const re = /currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    perEur[m[1]] = Number(m[2]);
  }

  if (Object.keys(perEur).length < 2) {
    throw new Error('ECB response parsed but contained no rates');
  }
  return { rateDate, perEur };
}

/** Derive an arbitrary pair by triangulating through EUR. */
export function deriveRate(
  perEur: Record<string, number>,
  from: Currency,
  to: Currency
): number {
  if (from === to) return 1;
  const f = perEur[from];
  const t = perEur[to];
  if (f === undefined) throw new Error(`No ECB rate for ${from}`);
  if (t === undefined) throw new Error(`No ECB rate for ${to}`);
  return t / f;
}

export interface PortfolioTotal {
  portfolioId: string;
  name: string;
  valueNative: number;
  currency: Currency;
}

export interface DisplayTotalResult {
  displayCurrency: Currency;
  /** Cosmetic. Never persist this, never feed it into a metric. */
  convertedTotal: number;
  rateDate: string;
  rateSource: string;
  components: Array<{
    portfolioId: string;
    name: string;
    valueNative: number;
    nativeCurrency: Currency;
    rateApplied: number;
    convertedValue: number;
  }>;
  /** The UI must render this. It is not optional. */
  disclaimer: string;
}

/**
 * The single sanctioned cross-currency operation in the system.
 *
 * Returns per-component rates alongside the total so the UI can show its work.
 * Named `displayTotal` rather than `getTotalValue` so that any future call site
 * reads as obviously display-scoped at the point of use.
 */
export function displayTotal(
  portfolios: PortfolioTotal[],
  displayCurrency: Currency,
  perEur: Record<string, number>,
  rateDate: string,
  rateSource = 'ECB'
): DisplayTotalResult {
  const components = portfolios.map((p) => {
    const rateApplied = deriveRate(perEur, p.currency, displayCurrency);
    return {
      portfolioId: p.portfolioId,
      name: p.name,
      valueNative: p.valueNative,
      nativeCurrency: p.currency,
      rateApplied,
      convertedValue: p.valueNative * rateApplied,
    };
  });

  return {
    displayCurrency,
    convertedTotal: components.reduce((a, c) => a + c.convertedValue, 0),
    rateDate,
    rateSource,
    components,
    disclaimer:
      `Converted at ${rateSource} reference rates dated ${rateDate}. ` +
      `Display only — no performance or risk figure in this system uses a converted value.`,
  };
}
