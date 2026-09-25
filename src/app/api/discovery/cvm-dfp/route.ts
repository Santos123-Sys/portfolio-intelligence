import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-auth';
import { assertSameOrigin } from '@/lib/auth';
import { retrieveCvmDfp } from '@/lib/cvm-dfp';
import { db } from '@/lib/db';
import { discoveryCandidates } from '@/lib/db/workflow-schema';
import { readBoundedJson } from '@/lib/request-body';
import { recordFundamentalObservations } from '@/lib/services/provenance';

export const runtime = 'nodejs';
const schema = z.object({ candidateId: z.string().uuid(), cnpj: z.string().regex(/^\d{14}$/), year: z.number().int().min(2020).max(new Date().getUTCFullYear()) }).strict();

export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try { assertSameOrigin(req); } catch { return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 }); }
  const body = await readBoundedJson(req, 4_096);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: 'Valid candidateId, 14-digit CNPJ and DFP year required' }, { status: 400 });
  const [candidate] = await db.select().from(discoveryCandidates).where(and(
    eq(discoveryCandidates.id, parsed.data.candidateId), eq(discoveryCandidates.ownerId, session.auth.userId)
  )).limit(1);
  if (!candidate?.securityId || !candidate.analysisId || candidate.exchange !== 'BVMF' || candidate.currency !== 'BRL')
    return NextResponse.json({ error: 'An approved B3/BRL candidate is required' }, { status: 409 });
  try {
    const filing = await retrieveCvmDfp(candidate.companyName, parsed.data.cnpj, parsed.data.year);
    if (!filing) return NextResponse.json({ error: 'No verified consolidated DFP facts matched that CNPJ, company and year. Check the CVM registration and filing.' }, { status: 422 });
    await recordFundamentalObservations(candidate.securityId, {
      ...filing.fundamentals, _source: filing.sourceName, _sourceUrl: filing.sourceUrl,
      _status: 'OK', _query: `CVM DFP ${parsed.data.year}, CNPJ ${parsed.data.cnpj}`,
      _evidenceSnippet: filing.evidenceSnippet, _currency: filing.currency, _observationDate: filing.periodEnd,
    }, 'investor-relations');
    return NextResponse.json({ importedMetrics: Object.keys(filing.fundamentals), periodEnd: filing.periodEnd,
      currency: filing.currency, sourceUrl: filing.sourceUrl, notice: filing.evidenceSnippet }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: `CVM DFP retrieval failed: ${(error as Error).message}` }, { status: 502 });
  }
}
