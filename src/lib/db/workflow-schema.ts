import { pgTable, uuid, text, timestamp, numeric, jsonb, index } from 'drizzle-orm/pg-core';
import { aiAnalyses, analysisJobs, securities, thesisVersions } from './schema';

/**
 * Atomic external-data evidence. This table is deliberately metric-oriented so
 * the system can keep the source URL, retrieval query, status and raw payload
 * next to every market or fundamental value consumed by downstream logic.
 */
export const marketDataObservations = pgTable(
  'market_data_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    securityId: uuid('security_id').references(() => securities.id, { onDelete: 'cascade' }).notNull(),
    observationType: text('observation_type').notNull(), // price | fundamental | search_evidence
    metricName: text('metric_name').notNull(),
    valueNumeric: numeric('value_numeric', { precision: 24, scale: 10 }),
    valueText: text('value_text'),
    currency: text('currency'),
    observationDate: text('observation_date'),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true }).defaultNow().notNull(),
    provider: text('provider').notNull(),
    sourceName: text('source_name'),
    sourceUrl: text('source_url'),
    query: text('query'),
    status: text('status').notNull(), // OK | DATA_UNAVAILABLE | PARSE_UNCERTAIN | ERROR
    evidenceSnippet: text('evidence_snippet'),
    rawPayload: jsonb('raw_payload'),
  },
  (t) => ({
    securityMetricIdx: index('market_observations_security_metric_idx').on(t.securityId, t.metricName, t.retrievedAt),
    statusIdx: index('market_observations_status_idx').on(t.status, t.retrievedAt),
  })
);

/** Human-in-the-loop decisions over AI-generated candidate analyses. */
export const candidateDecisions = pgTable(
  'candidate_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    analysisId: uuid('analysis_id').references(() => aiAnalyses.id, { onDelete: 'cascade' }).notNull(),
    decision: text('decision').notNull(), // accepted | rejected | watchlist | reanalysis_requested
    rationale: text('rationale'),
    decidedBy: text('decided_by').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb('metadata'),
  },
  (t) => ({ analysisDecisionIdx: index('candidate_decisions_analysis_idx').on(t.analysisId, t.decidedAt) })
);

/** Write-audit record for thesis mutations. */
export const thesisMutationAudit = pgTable(
  'thesis_mutation_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    thesisVersionId: uuid('thesis_version_id').references(() => thesisVersions.id, { onDelete: 'cascade' }).notNull(),
    action: text('action').notNull(),
    actor: text('actor').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb('metadata'),
  },
  (t) => ({ thesisAuditIdx: index('thesis_mutation_audit_thesis_idx').on(t.thesisVersionId, t.createdAt) })
);

/** Optional queue linkage when a candidate decision requests another analysis. */
export const candidateReanalysisRequests = pgTable(
  'candidate_reanalysis_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    decisionId: uuid('decision_id').references(() => candidateDecisions.id, { onDelete: 'cascade' }).notNull(),
    analysisJobId: uuid('analysis_job_id').references(() => analysisJobs.id, { onDelete: 'cascade' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ decisionIdx: index('candidate_reanalysis_decision_idx').on(t.decisionId) })
);
