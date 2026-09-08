import { z } from 'zod';

/**
 * Human-authored context for an investment decision. It intentionally records
 * the decision logic, not a model-generated score, so a later review can tell
 * what the investor believed and what would prove that belief wrong.
 */
export const decisionJournalSchema = z.object({
  decisionReason: z.string().trim().min(8).max(2_000),
  expectedHoldingPeriod: z.string().trim().min(2).max(120),
  valuationView: z.string().trim().min(8).max(1_000),
  principalRisk: z.string().trim().min(8).max(1_000),
  invalidationTrigger: z.string().trim().min(8).max(1_000),
}).strict();

export type DecisionJournal = z.infer<typeof decisionJournalSchema>;

export function decisionJournalAuditText(journal: DecisionJournal): string {
  return [
    `Holding period: ${journal.expectedHoldingPeriod}`,
    `Valuation view: ${journal.valuationView}`,
    `Principal risk: ${journal.principalRisk}`,
    `Invalidation trigger: ${journal.invalidationTrigger}`,
  ].join(' | ');
}
