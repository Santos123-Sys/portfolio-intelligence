import { pgTable, uuid, text, timestamp, jsonb, integer, index } from 'drizzle-orm/pg-core';
import { analysisJobs, securities, thesisVersions } from './schema';

/** One end-to-end multi-agent evaluation. */
export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    analysisJobId: uuid('analysis_job_id').references(() => analysisJobs.id, { onDelete: 'cascade' }).notNull(),
    securityId: uuid('security_id').references(() => securities.id, { onDelete: 'cascade' }).notNull(),
    thesisVersionId: uuid('thesis_version_id').references(() => thesisVersions.id).notNull(),
    status: text('status').notNull().default('running'),
    orchestratorVersion: text('orchestrator_version').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorMessage: text('error_message'),
  },
  (t) => ({ jobIdx: index('agent_runs_job_idx').on(t.analysisJobId), securityIdx: index('agent_runs_security_idx').on(t.securityId) })
);

/** Immutable structured output from each specialist agent. */
export const agentSteps = pgTable(
  'agent_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').references(() => agentRuns.id, { onDelete: 'cascade' }).notNull(),
    sequence: integer('sequence').notNull(),
    agentName: text('agent_name').notNull(),
    status: text('status').notNull().default('complete'),
    outputJson: jsonb('output_json').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ runSequenceIdx: index('agent_steps_run_sequence_idx').on(t.runId, t.sequence) })
);
