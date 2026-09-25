import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { discoveryCandidates } from '@/lib/db/workflow-schema';
import { retrieveInvestorRelationsFundamentals } from '@/lib/investor-relations';
import { recordFundamentalObservations } from '@/lib/services/provenance';
import { readBoundedJson } from '@/lib/request-body';
import { retrieveSecAnnualFilings } from '@/lib/sec-companyfacts';

export const runtime = 'nodejs';
const schema = z.object({ candidateId: z.string().uuid() }).strict();

export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try { assertSameOrigin(req); } catch { return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 }); }
  const body = await readBoundedJson(req, 4 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const [candidate] = await db.select().from(discoveryCandidates).where(and(
    eq(discoveryCandidates.id, parsed.data.candidateId),
    eq(discoveryCandidates.ownerId, session.auth.userId)
  )).limit(1);
  if (!candidate?.securityId || !candidate.analysisId) {
    return NextResponse.json({ error: 'Complete the approved security analysis before importing primary-source financials' }, { status: 409 });
  }
  try {
    const secFilings = candidate.currency === 'USD' && process.env.SEC_USER_AGENT
      ? await retrieveSecAnnualFilings(candidate.companyName, candidate.ticker, candidate.currency) : [];
    const fallback = secFilings.length ? null : await retrieveInvestorRelationsFundamentals(candidate.companyName, candidate.ticker, candidate.currency);
    const filings = secFilings.length ? secFilings : fallback?.extracted ? [fallback.extracted] : [];
    if (!filings.length) {
      return NextResponse.json({
        error: fallback?.skippedPdfCount
          ? 'No supported annual inline-XBRL facts were found in the candidate currency. Search also found PDF reports; those require a dedicated verified filing importer.'
          : 'No unambiguous annual inline-XBRL facts with a matching currency and reporting period were found for this company.',
      }, { status: 422 });
    }
    for (const filing of filings) {
      await recordFundamentalObservations(candidate.securityId, {
        ...filing.fundamentals,
        _source: filing.sourceName,
        _sourceUrl: filing.sourceUrl,
        _status: 'OK',
        _query: secFilings.length ? 'SEC Company Facts · verified CIK' : `Primary-source search via ${fallback?.searchProvider}`,
        _evidenceSnippet: filing.evidenceSnippet,
        _currency: filing.currency,
        _observationDate: filing.periodEnd,
      }, 'investor-relations');
    }
    const newest = filings.at(-1)!;
    return NextResponse.json({
      importedMetrics: Object.keys(newest.fundamentals),
      importedPeriods: filings.map((filing) => filing.periodEnd),
      sourceUrl: newest.sourceUrl,
      periodEnd: newest.periodEnd,
      currency: newest.currency,
      notice: newest.evidenceSnippet,
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: `Primary-source financial retrieval failed: ${(error as Error).message}` }, { status: 502 });
  }
}
