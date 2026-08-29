import { pgTable, uuid, text, timestamp, numeric, jsonb, index, uniqueIndex, integer, boolean } from 'drizzle-orm/pg-core';
import { aiAnalyses, portfolios, securities, thesisVersions, users } from './schema';

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

/** Versioned owner customization layered beneath immutable agent safety rules. */
export const agentConfigurations = pgTable(
  'agent_configurations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    agentKind: text('agent_kind').notNull(),
    versionNumber: integer('version_number').notNull(),
    name: text('name').notNull(),
    scope: text('scope').notNull(),
    promptAddendum: text('prompt_addendum').notNull().default(''),
    enabledTools: jsonb('enabled_tools').$type<string[]>().notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    ownerKindVersionIdx: uniqueIndex('agent_configs_owner_kind_version_idx')
      .on(t.ownerId, t.agentKind, t.versionNumber),
    activeIdx: index('agent_configs_owner_kind_active_idx').on(t.ownerId, t.agentKind, t.active),
  })
);

/** One provider-grounded opportunity-discovery job over a confirmed thesis. */
export const externalDiscoveryRuns = pgTable(
  'external_discovery_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    thesisVersionId: uuid('thesis_version_id').references(() => thesisVersions.id).notNull(),
    externalDiscoveryId: text('external_discovery_id').notNull().unique(),
    status: text('status').notNull().default('queued'),
    provider: text('provider').notNull(),
    requestJson: jsonb('request_json').notNull(),
    resultJson: jsonb('result_json'),
    errorMessage: text('error_message'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({ ownerStatusIdx: index('discovery_runs_owner_status_idx').on(t.ownerId, t.status, t.requestedAt) })
);

/** Shortlisted security awaiting an explicit human decision before analysis. */
export const discoveryCandidates = pgTable(
  'discovery_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    runId: uuid('run_id').references(() => externalDiscoveryRuns.id, { onDelete: 'cascade' }).notNull(),
    portfolioId: uuid('portfolio_id').references(() => portfolios.id, { onDelete: 'cascade' }).notNull(),
    securityId: uuid('security_id').references(() => securities.id, { onDelete: 'set null' }),
    ticker: text('ticker').notNull(),
    exchange: text('exchange').notNull(),
    companyName: text('company_name').notNull(),
    currency: text('currency').notNull(),
    country: text('country'),
    sector: text('sector'),
    discoveryJson: jsonb('discovery_json').notNull(),
    decision: text('decision').notNull().default('pending'),
    rationale: text('decision_rationale'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    workflowStatus: text('workflow_status').notNull().default('awaiting_review'),
    externalAnalysisRunId: text('external_analysis_run_id'),
    analysisId: uuid('analysis_id').references(() => aiAnalyses.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    runSecurityIdx: uniqueIndex('discovery_candidates_run_security_idx')
      .on(t.runId, t.portfolioId, t.exchange, t.ticker),
    ownerWorkflowIdx: index('discovery_candidates_owner_workflow_idx').on(t.ownerId, t.workflowStatus, t.createdAt),
  })
);

/** Deterministic standalone metrics calculated from a candidate's price series. */
export const securityRiskSnapshots = pgTable(
  'security_risk_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    candidateId: uuid('candidate_id').references(() => discoveryCandidates.id, { onDelete: 'cascade' }).notNull(),
    securityId: uuid('security_id').references(() => securities.id, { onDelete: 'cascade' }).notNull(),
    metricsJson: jsonb('metrics_json').notNull(),
    provider: text('provider').notNull(),
    dataAsOf: timestamp('data_as_of', { withTimezone: true }).notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ candidateTimeIdx: index('security_risk_candidate_time_idx').on(t.candidateId, t.computedAt) })
);

/** Human-confirmed assumptions and deterministic valuation output. */
export const valuationScenarios = pgTable(
  'valuation_scenarios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    candidateId: uuid('candidate_id').references(() => discoveryCandidates.id, { onDelete: 'cascade' }).notNull(),
    analysisId: uuid('analysis_id').references(() => aiAnalyses.id, { onDelete: 'set null' }),
    method: text('method').notNull(),
    status: text('status').notNull(),
    assumptionsJson: jsonb('assumptions_json').notNull(),
    resultJson: jsonb('result_json').notNull(),
    sourceReferences: jsonb('source_references').$type<string[]>().notNull(),
    approvedBy: text('approved_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ candidateCreatedIdx: index('valuation_candidate_created_idx').on(t.candidateId, t.createdAt) })
);

/** Human-in-the-loop decisions over AI-generated candidate analyses. */
export const candidateDecisions = pgTable(
  'candidate_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
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
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    thesisVersionId: uuid('thesis_version_id').references(() => thesisVersions.id, { onDelete: 'cascade' }).notNull(),
    action: text('action').notNull(),
    actor: text('actor').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb('metadata'),
  },
  (t) => ({ thesisAuditIdx: index('thesis_mutation_audit_thesis_idx').on(t.thesisVersionId, t.createdAt) })
);

/** Pending model extraction. It becomes canonical only after explicit human confirmation. */
export const externalThesisExtractions = pgTable(
  'external_thesis_extractions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    externalExtractionId: text('external_extraction_id').notNull().unique(),
    status: text('status').notNull().default('queued'),
    requestedVersion: integer('requested_version').notNull(),
    sourceFileName: text('source_file_name').notNull(),
    sourceMimeType: text('source_mime_type').notNull(),
    resultJson: jsonb('result_json'),
    errorMessage: text('error_message'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedThesisVersionId: uuid('confirmed_thesis_version_id')
      .references(() => thesisVersions.id, { onDelete: 'set null' }),
  },
  (t) => ({
    ownerStatusIdx: index('external_thesis_extractions_owner_status_idx').on(t.ownerId, t.status, t.requestedAt),
  })
);

/** Dashboard record of a run owned by the external agentic system. */
export const externalAgenticRuns = pgTable(
  'external_agentic_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    externalRunId: text('external_run_id').notNull().unique(),
    status: text('status').notNull().default('queued'),
    thesisVersion: text('thesis_version'),
    manifestSchemaVersion: text('manifest_schema_version'),
    manifestHash: text('manifest_hash'),
    requestJson: jsonb('request_json'),
    manifestJson: jsonb('manifest_json'),
    reportPdfUrl: text('report_pdf_url'),
    requestedAt: timestamp('requested_at').defaultNow().notNull(),
    completedAt: timestamp('completed_at'),
    importedAt: timestamp('imported_at'),
    errorMessage: text('error_message'),
  },
  (t) => ({
    statusIdx: index('external_agentic_runs_status_idx').on(t.status, t.requestedAt),
    hashIdx: index('external_agentic_runs_manifest_hash_idx').on(t.manifestHash),
  })
);

/** Portfolio-level synthesis imported from the external manifest. */
export const portfolioAnalysisSyntheses = pgTable(
  'portfolio_analysis_syntheses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').references(() => externalAgenticRuns.id, { onDelete: 'cascade' }).notNull(),
    portfolioId: uuid('portfolio_id').references(() => portfolios.id, { onDelete: 'cascade' }).notNull(),
    thesisVersion: text('thesis_version').notNull(),
    synthesisJson: jsonb('synthesis_json').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    runPortfolioIdx: uniqueIndex('portfolio_synthesis_run_portfolio_idx').on(t.runId, t.portfolioId),
  })
);

/** Complete external output retained for audit and fields not projected into ai_analyses. */
export const externalAgenticAnalyses = pgTable(
  'external_agentic_analyses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').references(() => externalAgenticRuns.id, { onDelete: 'cascade' }).notNull(),
    portfolioId: uuid('portfolio_id').references(() => portfolios.id, { onDelete: 'cascade' }).notNull(),
    securityId: uuid('security_id').references(() => securities.id, { onDelete: 'cascade' }).notNull(),
    analysisId: uuid('analysis_id').references(() => aiAnalyses.id, { onDelete: 'cascade' }).notNull(),
    outputJson: jsonb('output_json').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    runSecurityIdx: uniqueIndex('external_analysis_run_portfolio_security_idx').on(t.runId, t.portfolioId, t.securityId),
  })
);
