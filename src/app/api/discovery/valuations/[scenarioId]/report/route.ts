import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { discoveryCandidates, valuationScenarios } from '@/lib/db/workflow-schema';
import { dcfReportFileName, renderDcfReportPdf } from '@/lib/dcf-report';
import type { ThreeCaseDcfResult } from '@/lib/quant/dcf';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ scenarioId: string }> }) {
  const session = await authenticateRequest(_req);
  if (!session.ok) return session.response;
  const { scenarioId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(scenarioId)) return NextResponse.json({ error: 'A valid scenarioId is required' }, { status: 400 });
  const [record] = await db.select({
    scenario: valuationScenarios,
    companyName: discoveryCandidates.companyName,
    ticker: discoveryCandidates.ticker,
    exchange: discoveryCandidates.exchange,
  }).from(valuationScenarios).innerJoin(discoveryCandidates, eq(discoveryCandidates.id, valuationScenarios.candidateId))
    .where(and(eq(valuationScenarios.id, scenarioId), eq(valuationScenarios.ownerId, session.auth.userId))).limit(1);
  if (!record) return NextResponse.json({ error: 'DCF scenario not found' }, { status: 404 });
  if (record.scenario.method !== 'three_case_two_stage_fcff') {
    return NextResponse.json({ error: 'A native three-scenario DCF report is not available for this legacy valuation.' }, { status: 409 });
  }
  try {
    const pdf = await renderDcfReportPdf({
      companyName: record.companyName,
      ticker: record.ticker,
      exchange: record.exchange,
      result: record.scenario.resultJson as ThreeCaseDcfResult,
      sourceReferences: record.scenario.sourceReferences,
    });
    const body = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
    return new Response(body, { headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${dcfReportFileName(record.ticker)}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    } });
  } catch (error) {
    return NextResponse.json({ error: `DCF report generation failed: ${(error as Error).message}` }, { status: 500 });
  }
}
