import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-auth';
import { assertSameOrigin } from '@/lib/auth';
import { db } from '@/lib/db';
import { discoveryCandidates, financialDocumentDrafts, marketDataObservations } from '@/lib/db/workflow-schema';
import { readBoundedJson } from '@/lib/request-body';

export const runtime = 'nodejs';
const schema = z.object({ selectedIndices: z.array(z.number().int().nonnegative()).min(1).max(150) }).strict();
const metrics = ['revenue', 'gross_profit', 'operating_income', 'net_income', 'operating_cash_flow', 'capital_expenditure',
  'cash_and_equivalents', 'total_debt', 'total_equity', 'shares_outstanding'] as const;
const factSchema = z.object({ metric: z.enum(metrics), normalized_value: z.number().finite(), currency: z.string(),
  fiscal_period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), fiscal_period_start: z.string().nullable(),
  page: z.number().int().positive(), quote: z.string().min(1).max(1000), unit_multiplier: z.number(), value: z.number() });
const analysisSchema = z.object({ accepted_facts: z.array(factSchema).max(150), periods: z.array(z.object({
  period_end: z.string(), metrics: z.record(z.string(), z.number().finite()),
})).max(20) });

export async function POST(req: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try { assertSameOrigin(req); } catch { return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 }); }
  const { draftId } = await params;
  if (!z.string().uuid().safeParse(draftId).success) return NextResponse.json({ error: 'Valid draft ID required' }, { status: 400 });
  const body = await readBoundedJson(req, 4_096);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = schema.safeParse(body.value);
  if (!parsed.success || new Set(parsed.data.selectedIndices).size !== parsed.data.selectedIndices.length)
    return NextResponse.json({ error: 'Select unique fact indices to approve' }, { status: 400 });
  const [draft] = await db.select({ document: financialDocumentDrafts, securityId: discoveryCandidates.securityId,
    currency: discoveryCandidates.currency }).from(financialDocumentDrafts)
    .innerJoin(discoveryCandidates, eq(discoveryCandidates.id, financialDocumentDrafts.candidateId))
    .where(and(eq(financialDocumentDrafts.id, draftId), eq(financialDocumentDrafts.ownerId, session.auth.userId),
      eq(discoveryCandidates.ownerId, session.auth.userId))).limit(1);
  if (!draft?.securityId || draft.document.status !== 'awaiting_review')
    return NextResponse.json({ error: 'Reviewable document not found' }, { status: 404 });
  const analysis = analysisSchema.safeParse(draft.document.analysisJson);
  if (!analysis.success) return NextResponse.json({ error: 'Stored extraction contract is invalid' }, { status: 409 });
  const selected = parsed.data.selectedIndices.map((index) => analysis.data.accepted_facts[index]);
  if (selected.some((fact) => !fact || fact.currency !== draft.currency
    || ![1, 1000, 1_000_000].includes(fact.unit_multiplier)
    || fact.normalized_value !== fact.value * fact.unit_multiplier
    || Math.abs(fact.normalized_value) > Number.MAX_SAFE_INTEGER
    || (fact.fiscal_period_start ? !Number.isFinite(Date.parse(fact.fiscal_period_start))
      || (Date.parse(fact.fiscal_period_end) - Date.parse(fact.fiscal_period_start)) / 86_400_000 < 330
      || (Date.parse(fact.fiscal_period_end) - Date.parse(fact.fiscal_period_start)) / 86_400_000 > 380
      : !['cash_and_equivalents', 'total_debt', 'total_equity', 'shares_outstanding'].includes(fact.metric))))
    return NextResponse.json({ error: 'Selected facts do not match the issuer currency or extraction' }, { status: 400 });
  const sourceUrl = `/api/discovery/financial-documents/${draftId}/pdf`;
  const rows = selected.map((fact) => ({
    securityId: draft.securityId!, observationType: 'fundamental', metricName: fact!.metric,
    valueNumeric: String(fact!.normalized_value), currency: fact!.metric === 'shares_outstanding' ? null : fact!.currency,
    observationDate: fact!.fiscal_period_end, provider: 'investor-relations', status: 'OK',
    sourceName: draft.document.fileName, sourceUrl,
    evidenceSnippet: `Page ${fact!.page}: ${fact!.quote}`,
    rawPayload: { pdfSha256: draft.document.sha256, page: fact!.page, originalValue: fact!.value,
      unitMultiplier: fact!.unit_multiplier, fiscalStart: fact!.fiscal_period_start, reviewedBy: session.auth.userId },
  }));
  // Persist the approval and every selected fact atomically. A retry cannot duplicate observations.
  const approved = await db.transaction(async (tx) => {
    const [updated] = await tx.update(financialDocumentDrafts).set({ status: 'approved', approvedAt: new Date() })
      .where(and(eq(financialDocumentDrafts.id, draftId), eq(financialDocumentDrafts.ownerId, session.auth.userId),
        eq(financialDocumentDrafts.status, 'awaiting_review'))).returning({ id: financialDocumentDrafts.id });
    if (!updated) return false;
    await tx.insert(marketDataObservations).values(rows);
    return true;
  });
  return approved ? NextResponse.json({ approvedFacts: rows.length, sourceUrl })
    : NextResponse.json({ error: 'Draft was already reviewed' }, { status: 409 });
}
