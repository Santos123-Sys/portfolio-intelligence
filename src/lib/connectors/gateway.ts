/**
 * The seam between a connector's raw network calls and whatever accounts for
 * them. A connector depends only on this interface, never on the database —
 * `passthroughGateway` is what makes a connector work with no accounting at
 * all, which is what every connector got before this file existed and what
 * tests still get unless they inject something else.
 *
 * The real, DB-backed implementation is `DatabaseProviderGateway` in
 * src/lib/services/provider-gateway.ts, wired in by
 * src/lib/connectors/index.ts — the one place allowed to know about both the
 * connector layer and the persistence layer. Keeping the dependency here
 * rather than in the connector itself is what lets `EodhdProvider` (and any
 * future FinnhubProvider, FmpProvider, TavilyProvider, ...) stay free of a
 * `db` import while still being accountable to one.
 */

export type CallOutcome = 'ok' | 'plan_limit' | 'rate_limited' | 'error';

export interface CallResult {
  outcome: CallOutcome;
  httpStatus: number;
}

export interface RequestGateway {
  run<T>(params: {
    provider: string;
    /** A stable route template — no API key, no per-symbol path segment. See endpointTemplate(). */
    endpoint: string;
    perform: () => Promise<T>;
    /** Reads the outcome off a successfully-returned result. Not called if perform() throws. */
    classify: (result: T) => CallResult;
  }): Promise<T>;
}

/** The default for any connector or test that does not need accounting. */
export const passthroughGateway: RequestGateway = {
  run: ({ perform }) => perform(),
};

/**
 * Collapses a path's trailing dynamic segment so per-symbol or per-exchange
 * calls share one accounting bucket instead of fragmenting into one row per
 * ticker. '/api/screener' stays itself; '/api/eod/NESN.SW' and
 * '/api/eod/ROG.SW' both become '/api/eod/:param'. A plan limit or rate limit
 * applies to the route family, not to one ticker, and a thousand
 * ticker-specific rows would tell the gateway nothing that one row does not.
 */
export function endpointTemplate(path: string): string {
  const segments = path.split('/').filter(Boolean);
  return segments.length > 2 ? `/${segments[0]}/${segments[1]}/:param` : `/${segments.join('/')}`;
}

/**
 * Thrown by a RequestGateway that has already seen this provider+endpoint
 * return a plan-limit outcome recently enough to trust, and skips repeating a
 * network call already known to fail. Distinct from an HTTP-level error
 * because no request was made — retrying immediately cannot help, but the
 * memory itself expires, so retrying later can.
 */
export class KnownPlanLimitError extends Error {
  constructor(
    readonly provider: string,
    readonly endpoint: string,
    readonly lastHttpStatus: number,
    readonly lastSeenAt: Date
  ) {
    super(
      `${provider} ${endpoint} is known not to be included on this plan (last confirmed ` +
        `${lastSeenAt.toISOString()} with HTTP ${lastHttpStatus}). Skipped without a network call.`
    );
    this.name = 'KnownPlanLimitError';
  }
}

/**
 * Thrown by a RequestGateway when a call would exceed a self-imposed budget.
 * This is not a vendor limit — it is this application declining to place a
 * call, so a caller must never treat it the way it treats a plan limit (a
 * real, durable "not on your plan" fact); it means "not right now."
 */
export class CallBudgetExceededError extends Error {
  constructor(readonly provider: string, readonly window: 'minute' | 'day', readonly limit: number) {
    super(`${provider} would exceed its self-imposed ${window} call budget of ${limit}.`);
    this.name = 'CallBudgetExceededError';
  }
}

/**
 * Pure, in-memory sliding-window limiter for the per-minute budget. Kept
 * separate from DatabaseProviderGateway so the one piece of rate-limiting
 * logic that changes on every call can be unit-tested without a database.
 *
 * In-memory and therefore per-process: correct for a single long-running
 * dashboard instance, and safe even if that assumption ever stops holding — a
 * process restart resets the window to empty, which under-counts rather than
 * over-counts, so the failure mode is one needlessly cautious minute after a
 * deploy, never a burst past the real vendor limit.
 */
export class MinuteBudgetTracker {
  private readonly attempts = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  /** True if `provider` has already made `limit` or more attempts in the last 60s. */
  wouldExceed(provider: string, limit: number): boolean {
    return this.recentAttempts(provider).length >= limit;
  }

  /** Records an attempt now. Call only after wouldExceed() has been checked. */
  record(provider: string): void {
    const attempts = this.recentAttempts(provider);
    attempts.push(this.now());
    this.attempts.set(provider, attempts);
  }

  private recentAttempts(provider: string): number[] {
    const windowStart = this.now() - 60_000;
    const attempts = (this.attempts.get(provider) ?? []).filter((t) => t > windowStart);
    this.attempts.set(provider, attempts);
    return attempts;
  }
}
