import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-auth';
import { loadFinancialAnalysisReport } from '@/lib/financial-report-data';

export const runtime = 'nodejs';
export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const candidateId = z.string().uuid().safeParse(new URL(req.url).searchParams.get('candidateId'));
  if (!candidateId.success) return NextResponse.json({ error: 'Valid candidateId required' }, { status: 400 });
  const report = await loadFinancialAnalysisReport(session.auth.userId, candidateId.data);
  return report ? NextResponse.json(report, { headers: { 'cache-control': 'private, no-store' } })
    : NextResponse.json({ error: 'Approved candidate not found' }, { status: 404 });
}
