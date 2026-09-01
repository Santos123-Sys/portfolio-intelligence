/**
 * Market data connector interface.
 *
 * ADR-005 is still open — no vendor is chosen. This interface exists so that
 * choosing one later is a config change rather than a rewrite, and so the rest
 * of the system can be built and tested against the stub in the meantime.
 *
 * The lesson behind this abstraction is concrete: IEX Cloud was a popular,
 * affordable choice until IEX Group shut it down entirely on 31 August 2024.
 * Anything written directly against a vendor SDK died that day.
 */

export type DataStatus = 'OK' | 'DATA_UNAVAILABLE' | 'PARSE_UNCERTAIN' | 'ERROR';

export interface DataProvenance {
  provider: string;
  sourceName?: string;
  sourceUrl?: string;
  query?: string;
  status: DataStatus;
  evidenceSnippet?: string;
  rawPayload?: unknown;
}

export interface DailyBar {
  date: string; // ISO yyyy-mm-dd
  close: number;
  currency: string;
  provenance?: DataProvenance;
}

export interface Fundamentals {
  [key: string]: number | string | null;
}

export interface FundamentalsRequestOptions {
  /** Recheck provider entitlement once after an explicit human retry. */
  bypassPlanLimitMemory?: boolean;
}

export interface PriceProvider {
  readonly name: string;
  /** MIC codes this provider is confirmed to cover. */
  readonly supportedExchanges: string[];
  getDailyBars(ticker: string, exchange: string, fromDate: string, toDate: string): Promise<DailyBar[]>;
  getLatestPrice(ticker: string, exchange: string): Promise<DailyBar | null>;
  getFundamentals?(ticker: string, exchange: string, options?: FundamentalsRequestOptions): Promise<Fundamentals>;
  /** Provider-backed security universe used by the discovery agent. */
  getSecurityUniverse?(exchange: string, limit: number): Promise<import('@portfolio-intelligence/agentic-contract').SecurityUniverseRecord[]>;
}

export class ProviderError extends Error {
  constructor(message: string, public readonly provider: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** MIC codes this project needs. Any candidate vendor must cover both. */
export const REQUIRED_EXCHANGES = ['XSWX', 'BVMF'] as const;

export function assertCoversRequiredExchanges(p: PriceProvider): void {
  const missing = REQUIRED_EXCHANGES.filter((e) => !p.supportedExchanges.includes(e));
  if (missing.length > 0) {
    throw new ProviderError(
      `Provider does not cover required exchanges: ${missing.join(', ')}. ` +
        `This project holds SIX Swiss (XSWX) and B3 (BVMF) listings.`,
      p.name
    );
  }
}
