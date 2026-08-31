import { and, desc, eq, gte, sql } from 'drizzle-orm';
import {
  CallBudgetExceededError,
  KnownPlanLimitError,
  MinuteBudgetTracker,
  type CallResult,
  type RequestGateway,
} from '../connectors/gateway';
import { db } from '../db';
import { providerCalls } from '../db/workflow-schema';
import { getEnv } from '../env';

export interface ProviderBudget {
  callsPerMinute: number;
  callsPerDay: number;
}

export interface ProviderGatewayOptions {
  budget?: ProviderBudget;
  /** How long a plan_limit outcome is trusted before the gateway will try the endpoint again. */
  planLimitMemoryMs?: number;
  now?: () => number;
}

/**
 * DB-backed rate limiting, plan-limit memory and call accounting for external
 * market-data providers. Every attempted call — win or lose — is persisted to
 * provider_calls before this returns, which is what makes "why is my universe
 * unranked" and "how much of today's budget is spent" answerable rather than
 * guessed at.
 *
 * Three checks run before every call, cheapest first:
 *
 *   1. Plan-limit memory (DB) — has this exact provider+endpoint returned a
 *      plan_limit outcome recently enough to trust? If so, skip the network
 *      call entirely rather than repeat a request already known to fail.
 *   2. Minute budget (in-memory) — see MinuteBudgetTracker.
 *   3. Day budget (DB) — has this provider already made callsPerDay attempts
 *      today? DB-backed because it must survive a restart mid-day; an
 *      in-memory daily counter would reopen a budget a deploy had already
 *      spent.
 *
 * A DB write failure while recording a call is swallowed, not surfaced:
 * accounting must never take down the data call it is accounting for.
 */
export class DatabaseProviderGateway implements RequestGateway {
  private readonly budget: ProviderBudget;
  private readonly planLimitMemoryMs: number;
  private readonly now: () => number;
  private readonly minuteBudget: MinuteBudgetTracker;

  constructor(options: ProviderGatewayOptions = {}) {
    const env = getEnv();
    this.budget = options.budget ?? {
      callsPerMinute: env.MARKET_DATA_GATEWAY_CALLS_PER_MINUTE,
      callsPerDay: env.MARKET_DATA_GATEWAY_CALLS_PER_DAY,
    };
    this.planLimitMemoryMs =
      options.planLimitMemoryMs ?? env.MARKET_DATA_GATEWAY_PLAN_LIMIT_MEMORY_HOURS * 60 * 60 * 1000;
    this.now = options.now ?? Date.now;
    this.minuteBudget = new MinuteBudgetTracker(this.now);
  }

  private async checkPlanLimitMemory(provider: string, endpoint: string): Promise<void> {
    const since = new Date(this.now() - this.planLimitMemoryMs);
    const [recent] = await db
      .select({ httpStatus: providerCalls.httpStatus, calledAt: providerCalls.calledAt })
      .from(providerCalls)
      .where(and(
        eq(providerCalls.provider, provider),
        eq(providerCalls.endpoint, endpoint),
        eq(providerCalls.outcome, 'plan_limit'),
        gte(providerCalls.calledAt, since)
      ))
      .orderBy(desc(providerCalls.calledAt))
      .limit(1);
    if (recent) {
      throw new KnownPlanLimitError(provider, endpoint, recent.httpStatus ?? 0, recent.calledAt);
    }
  }

  private async checkDayBudget(provider: string): Promise<void> {
    const dayStart = new Date(this.now());
    dayStart.setUTCHours(0, 0, 0, 0);
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(providerCalls)
      .where(and(eq(providerCalls.provider, provider), gte(providerCalls.calledAt, dayStart)));
    if ((row?.count ?? 0) >= this.budget.callsPerDay) {
      throw new CallBudgetExceededError(provider, 'day', this.budget.callsPerDay);
    }
  }

  private async record(
    provider: string,
    endpoint: string,
    outcome: CallResult['outcome'],
    httpStatus: number | null,
    durationMs: number
  ): Promise<void> {
    try {
      await db.insert(providerCalls).values({ provider, endpoint, outcome, httpStatus, durationMs });
    } catch {
      // Accounting must never take down the data call it is accounting for.
    }
  }

  async run<T>(params: {
    provider: string;
    endpoint: string;
    perform: () => Promise<T>;
    classify: (result: T) => CallResult;
  }): Promise<T> {
    const { provider, endpoint, perform, classify } = params;

    await this.checkPlanLimitMemory(provider, endpoint);
    if (this.minuteBudget.wouldExceed(provider, this.budget.callsPerMinute)) {
      throw new CallBudgetExceededError(provider, 'minute', this.budget.callsPerMinute);
    }
    await this.checkDayBudget(provider);
    this.minuteBudget.record(provider);

    const startedAt = this.now();
    let result: T;
    try {
      result = await perform();
    } catch (error) {
      await this.record(provider, endpoint, 'error', null, this.now() - startedAt);
      throw error;
    }
    const { outcome, httpStatus } = classify(result);
    await this.record(provider, endpoint, outcome, httpStatus, this.now() - startedAt);
    return result;
  }
}

let sharedGateway: DatabaseProviderGateway | null = null;

/** The gateway every connector should share, so budgets are enforced per provider, not per connector instance. */
export function getProviderGateway(): DatabaseProviderGateway {
  if (!sharedGateway) sharedGateway = new DatabaseProviderGateway();
  return sharedGateway;
}
