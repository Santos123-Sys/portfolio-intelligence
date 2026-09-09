import { desc, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { discoveryCandidates, externalAgenticRuns, externalDiscoveryRuns, externalThesisExtractions } from '@/lib/db/workflow-schema';

export const runtime = 'nodejs';

/** A presentation-safe activity index. It deliberately omits opaque external run IDs. */
export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  if (!session.auth.isPlatformAdmin) return NextResponse.json({ error: 'Research history is restricted to the platform administrator' }, { status: 403 });
  const [extractions, discoveries, analyses] = await Promise.all([
    db.select({ status: externalThesisExtractions.status, sourceFileName: externalThesisExtractions.sourceFileName, requestedAt: externalThesisExtractions.requestedAt, completedAt: externalThesisExtractions.completedAt, errorMessage: externalThesisExtractions.errorMessage, confirmedAt: externalThesisExtractions.confirmedAt, dismissedAt: externalThesisExtractions.dismissedAt })
      .from(externalThesisExtractions).where(eq(externalThesisExtractions.ownerId, session.auth.userId)).orderBy(desc(externalThesisExtractions.requestedAt)).limit(30),
    db.select({ id: externalDiscoveryRuns.id, status: externalDiscoveryRuns.status, provider: externalDiscoveryRuns.provider, requestedAt: externalDiscoveryRuns.requestedAt, completedAt: externalDiscoveryRuns.completedAt, errorMessage: externalDiscoveryRuns.errorMessage })
      .from(externalDiscoveryRuns).where(eq(externalDiscoveryRuns.ownerId, session.auth.userId)).orderBy(desc(externalDiscoveryRuns.requestedAt)).limit(30),
    db.select({ externalRunId: externalAgenticRuns.externalRunId, status: externalAgenticRuns.status, requestedAt: externalAgenticRuns.requestedAt, completedAt: externalAgenticRuns.completedAt, reportAvailable: externalAgenticRuns.reportPdfUrl, errorMessage: externalAgenticRuns.errorMessage })
      .from(externalAgenticRuns).where(eq(externalAgenticRuns.ownerId, session.auth.userId)).orderBy(desc(externalAgenticRuns.requestedAt)).limit(30),
  ]);
  const discoveryCounts = discoveries.length ? await db.select({ runId: discoveryCandidates.runId }).from(discoveryCandidates).where(inArray(discoveryCandidates.runId, discoveries.map((run) => run.id))) : [];
  const byRun = new Map<string, number>();
  for (const row of discoveryCounts) byRun.set(row.runId, (byRun.get(row.runId) ?? 0) + 1);
  const candidates = analyses.length ? await db.select({ externalAnalysisRunId: discoveryCandidates.externalAnalysisRunId, companyName: discoveryCandidates.companyName })
    .from(discoveryCandidates).where(inArray(discoveryCandidates.externalAnalysisRunId, analyses.map((run) => run.externalRunId))) : [];
  const namesByAnalysis = new Map<string, string[]>();
  for (const row of candidates) if (row.externalAnalysisRunId) namesByAnalysis.set(row.externalAnalysisRunId, [...(namesByAnalysis.get(row.externalAnalysisRunId) ?? []), row.companyName]);
  return NextResponse.json({
    folders: [
      { key: 'thesis', title: 'Thesis extraction', description: 'Uploaded thesis documents and their extraction status.', items: extractions.filter((item) => !item.dismissedAt).map((item) => ({ title: item.sourceFileName, status: item.confirmedAt ? 'confirmed' : item.status, requestedAt: item.requestedAt, completedAt: item.completedAt, detail: item.errorMessage ?? (item.confirmedAt ? 'Confirmed into the investment thesis.' : 'Awaiting review or processing.') })) },
      { key: 'discovery', title: 'Market discovery', description: 'Provider-backed market research and candidate shortlists.', items: discoveries.map((item) => ({ title: `${byRun.get(item.id) ?? 0} candidates found`, status: item.status, requestedAt: item.requestedAt, completedAt: item.completedAt, detail: item.errorMessage ?? `Market-research run using ${item.provider}.` })) },
      { key: 'analysis', title: 'Company research', description: 'Approved-candidate research, risk analysis, and investment reports.', items: analyses.map((item) => ({ title: (namesByAnalysis.get(item.externalRunId) ?? []).join(', ') || 'Company research', status: item.status, requestedAt: item.requestedAt, completedAt: item.completedAt, detail: item.errorMessage ?? (item.reportAvailable ? 'Research report is available.' : 'Research evidence is being processed.') })) },
    ],
  });
}
