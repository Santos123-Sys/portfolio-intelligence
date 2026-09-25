import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-auth';
import { loadFinancialAnalysisReport } from '@/lib/financial-report-data';
import { renderFinancialReportPdf } from '@/lib/financial-report-pdf';

export const runtime = 'nodejs';
export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const candidateId = z.string().uuid().safeParse(new URL(req.url).searchParams.get('candidateId'));
  if (!candidateId.success) return NextResponse.json({ error: 'Valid candidateId required' }, { status: 400 });
  const report = await loadFinancialAnalysisReport(session.auth.userId, candidateId.data);
  if (!report) return NextResponse.json({ error: 'Approved candidate not found' }, { status: 404 });
  const pdf = await renderFinancialReportPdf(report);
  return new Response(new Uint8Array(pdf), { headers: {
    'content-type': 'application/pdf',
    'content-disposition': `attachment; filename="${report.ticker.replace(/[^A-Za-z0-9]/g, '') || 'company'}-financial-analysis.pdf"`,
    'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
  } });
}
