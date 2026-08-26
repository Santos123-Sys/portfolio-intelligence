/**
 * Database schema — the single source of truth for the whole system.
 *
 * Every entity from the architecture document is here, plus two additions
 * documented at the bottom of this file.
 *
 * ADR-002 note: monetary columns are suffixed `Native` and every table carrying
 * money also carries an explicit currency. There is deliberately no
 * `marketValueBase` column. An earlier draft of the architecture had one; the
 * native-currency decision removed the concept of a system-wide base currency,
 * so storing a pre-converted value would reintroduce blended figures through the
 * back door. Display conversion happens at render time and is never persisted.
 */

import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  timestamp,
  date,
  boolean,
  real,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull().default('owner'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
  },
  (t) => ({ emailIdx: uniqueIndex('users_email_idx').on(t.email) })
);

/** Revocable, server-side sessions. Only a SHA-256 token digest is persisted. */
export const userSessions = pgTable(
  'user_sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    tokenIdx: uniqueIndex('user_sessions_token_hash_idx').on(t.tokenHash),
    userExpiryIdx: index('user_sessions_user_expiry_idx').on(t.userId, t.expiresAt),
  })
);

export const portfolios = pgTable(
  'portfolios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    name: text('name').notNull(),
    /** 'swiss_quality' | 'brazilian_growth' | 'fixed_income' */
    portfolioType: text('portfolio_type').notNull(),
    /** The native currency. All metrics for this portfolio are reported in it. */
    baseCurrency: text('base_currency').notNull(),
    investmentObjective: text('investment_objective'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ ownerIdx: index('portfolios_owner_idx').on(t.ownerId) })
);

export const securities = pgTable(
  'securities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticker: text('ticker').notNull(),
    companyName: text('company_name').notNull(),
    /** MIC code: XSWX (SIX Swiss), BVMF (B3), etc. */
    exchange: text('exchange').notNull(),
    currency: text('currency').notNull(),
    sector: text('sector'),
    industry: text('industry'),
    country: text('country'),
    isin: text('isin'),
  },
  (t) => ({
    tickerExchangeIdx: uniqueIndex('securities_ticker_exchange_idx').on(
      t.ticker,
      t.exchange
    ),
  })
);

export const positions = pgTable(
  'positions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    portfolioId: uuid('portfolio_id')
      .references(() => portfolios.id, { onDelete: 'cascade' })
      .notNull(),
    securityId: uuid('security_id')
      .references(() => securities.id)
      .notNull(),
    quantity: numeric('quantity', { precision: 20, scale: 8 }).notNull(),
    avgCost: numeric('avg_cost', { precision: 20, scale: 8 }).notNull(),
    marketValueNative: numeric('market_value_native', { precision: 20, scale: 4 }),
    /** 0..1, computed by the quant engine, never by the UI. */
    weight: real('weight'),
    lastPricedAt: timestamp('last_priced_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    portfolioIdx: index('positions_portfolio_idx').on(t.portfolioId),
    uniqueHolding: uniqueIndex('positions_portfolio_security_idx').on(
      t.portfolioId,
      t.securityId
    ),
  })
);

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    portfolioId: uuid('portfolio_id')
      .references(() => portfolios.id, { onDelete: 'cascade' })
      .notNull(),
    securityId: uuid('security_id').references(() => securities.id),
    txnDate: date('txn_date').notNull(),
    /** 'buy' | 'sell' | 'deposit' | 'withdrawal' | 'dividend' | 'fee' */
    side: text('side').notNull(),
    quantity: numeric('quantity', { precision: 20, scale: 8 }),
    price: numeric('price', { precision: 20, scale: 8 }),
    fees: numeric('fees', { precision: 20, scale: 4 }).default('0'),
    currency: text('currency').notNull(),
    notes: text('notes'),
  },
  (t) => ({
    portfolioDateIdx: index('transactions_portfolio_date_idx').on(
      t.portfolioId,
      t.txnDate
    ),
  })
);

export const priceHistory = pgTable(
  'price_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    securityId: uuid('security_id')
      .references(() => securities.id, { onDelete: 'cascade' })
      .notNull(),
    priceDate: date('price_date').notNull(),
    close: numeric('close', { precision: 20, scale: 8 }).notNull(),
    currency: text('currency').notNull(),
    /** Which connector produced this row — required for auditability. */
    source: text('source').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    securityDateIdx: uniqueIndex('price_history_security_date_idx').on(
      t.securityId,
      t.priceDate
    ),
  })
);

/**
 * FX rates. Retained under the native-currency decision because the display-only
 * total conversion needs them, and because cross-listed comparisons may.
 * Nothing in the quant engine reads this table.
 */
export const fxRates = pgTable(
  'fx_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromCurrency: text('from_currency').notNull(),
    toCurrency: text('to_currency').notNull(),
    rate: numeric('rate', { precision: 20, scale: 10 }).notNull(),
    rateDate: date('rate_date').notNull(),
    source: text('source').notNull().default('ECB'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pairDateIdx: uniqueIndex('fx_rates_pair_date_idx').on(
      t.fromCurrency,
      t.toCurrency,
      t.rateDate
    ),
  })
);

/**
 * Versioned investment thesis. Every AI analysis references the version it was
 * scored against, so a changed recommendation can be attributed to a changed
 * thesis rather than to model drift.
 */
export const thesisVersions = pgTable(
  'thesis_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    versionNumber: integer('version_number').notNull(),
    criteriaJson: jsonb('criteria_json').notNull(),
    rawDocument: text('raw_document'),
    effectiveDate: timestamp('effective_date', { withTimezone: true }).defaultNow().notNull(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (t) => ({ ownerVersionIdx: uniqueIndex('thesis_versions_owner_version_idx').on(t.ownerId, t.versionNumber) })
);

export const aiAnalyses = pgTable(
  'ai_analyses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    portfolioId: uuid('portfolio_id').references(() => portfolios.id, { onDelete: 'cascade' }).notNull(),
    securityId: uuid('security_id')
      .references(() => securities.id, { onDelete: 'cascade' })
      .notNull(),
    thesisVersionId: uuid('thesis_version_id')
      .references(() => thesisVersions.id)
      .notNull(),
    portfolioCandidate: boolean('portfolio_candidate').notNull().default(false),
    portfolioRole: text('portfolio_role').notNull(),
    investmentScore: integer('investment_score').notNull(),
    thesisAlignmentScore: integer('thesis_alignment_score').notNull(),
    qualityScore: integer('quality_score'),
    growthScore: integer('growth_score'),
    riskScore: integer('risk_score'),
    dividendScore: integer('dividend_score'),
    fundamentalSummary: text('fundamental_summary'),
    investmentThesis: text('investment_thesis'),
    keyCatalysts: jsonb('key_catalysts').$type<string[]>(),
    keyRisks: jsonb('key_risks').$type<string[]>(),
    thesisBreakers: jsonb('thesis_breakers').$type<string[]>(),
    confidenceScore: real('confidence_score').notNull(),
    /**
     * The audit trail: which deterministic values this conclusion rested on,
     * by metric name and timestamp. An analysis with an empty groundedIn is a
     * conclusion drawn from no data and should be treated as such.
     */
    groundedIn: jsonb('grounded_in').$type<string[]>(),
    /** Full data-completeness disclosure from the external agentic contract. */
    informationGaps: jsonb('information_gaps').$type<string[]>(),
    /** External run that produced this imported analysis, when applicable. */
    externalRunId: uuid('external_run_id'),
    /** Points at the analysis this one replaced, so changes render as a diff. */
    supersedesId: uuid('supersedes_id'),
    analysisTimestamp: timestamp('analysis_timestamp', { withTimezone: true })
      .defaultNow()
      .notNull(),
    dataTimestamp: timestamp('data_timestamp', { withTimezone: true }),
    agentVersion: text('agent_version').notNull(),
  },
  (t) => ({
    securityIdx: index('ai_analyses_security_idx').on(t.securityId),
    timestampIdx: index('ai_analyses_timestamp_idx').on(t.analysisTimestamp),
  })
);

/**
 * Computed metrics, persisted with their full methodology so the dashboard can
 * render the explainability drill-down without recalculating anything.
 */
export const riskMetrics = pgTable(
  'risk_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    portfolioId: uuid('portfolio_id')
      .references(() => portfolios.id, { onDelete: 'cascade' })
      .notNull(),
    metricName: text('metric_name').notNull(),
    value: real('value').notNull(),
    /** Never null — ADR-002. */
    currency: text('currency').notNull(),
    methodology: text('methodology').notNull(),
    confidenceLevel: real('confidence_level'),
    horizonDays: integer('horizon_days'),
    lookbackDays: integer('lookback_days'),
    annualizationFactor: integer('annualization_factor'),
    caveat: text('caveat'),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
    dataAsOf: timestamp('data_as_of', { withTimezone: true }),
  },
  (t) => ({
    portfolioMetricIdx: index('risk_metrics_portfolio_metric_idx').on(
      t.portfolioId,
      t.metricName,
      t.computedAt
    ),
  })
);

export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    /** 'portfolio' | 'market' | 'thesis' */
    alertType: text('alert_type').notNull(),
    /** 'info' | 'watch' | 'breach' */
    severity: text('severity').notNull(),
    portfolioId: uuid('portfolio_id').references(() => portfolios.id),
    securityId: uuid('security_id').references(() => securities.id),
    headline: text('headline').notNull(),
    detail: text('detail'),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ createdIdx: index('alerts_created_idx').on(t.createdAt) })
);

/** Append-only. Nothing in the application issues UPDATE or DELETE here. */
export const decisionLog = pgTable('decision_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  decisionDate: timestamp('decision_date', { withTimezone: true })
    .defaultNow()
    .notNull(),
  title: text('title').notNull(),
  decision: text('decision').notNull(),
  reasoning: text('reasoning'),
  alternativesConsidered: text('alternatives_considered'),
  outcome: text('outcome'),
  relatedSecurityId: uuid('related_security_id').references(() => securities.id),
  relatedPortfolioId: uuid('related_portfolio_id').references(() => portfolios.id),
});

/**
 * ADDITION. Distributed lock, replacing the Postgres advisory lock the Replit
 * design used. Scheduled jobs can have at-least-once delivery and no concurrency
 * guarantee, so two overlapping refresh runs writing FX rates is a live risk.
 * A table-based lease survives across serverless invocations, which a session-
 * scoped `pg_advisory_lock` would not — advisory locks release when the
 * connection closes, and serverless connections close constantly.
 */
export const jobLocks = pgTable('job_locks', {
  lockName: text('lock_name').primaryKey(),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  holder: text('holder').notNull(),
});
