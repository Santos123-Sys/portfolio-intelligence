import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { aiAnalyses, securities, thesisVersions } from '@/lib/db/schema';
import { requirePageSession } from '@/lib/page-auth';

export const dynamic = 'force-dynamic';

export default async function AIInsightsPage() {
  const session = await requirePageSession();
  const rows = await db
    .select({
      id: aiAnalyses.id,
      ticker: securities.ticker,
      companyName: securities.companyName,
      role: aiAnalyses.portfolioRole,
      score: aiAnalyses.investmentScore,
      confidence: aiAnalyses.confidenceScore,
      summary: aiAnalyses.fundamentalSummary,
      thesis: aiAnalyses.investmentThesis,
      catalysts: aiAnalyses.keyCatalysts,
      risks: aiAnalyses.keyRisks,
      breakers: aiAnalyses.thesisBreakers,
      groundedIn: aiAnalyses.groundedIn,
      thesisVersion: thesisVersions.versionNumber,
      timestamp: aiAnalyses.analysisTimestamp,
    })
    .from(aiAnalyses)
    .innerJoin(securities, eq(aiAnalyses.securityId, securities.id))
    .innerJoin(thesisVersions, eq(aiAnalyses.thesisVersionId, thesisVersions.id))
    .where(eq(aiAnalyses.ownerId, session.userId))
    .orderBy(desc(aiAnalyses.analysisTimestamp));

  return (
    <main>
      <h1>AI Insights</h1>
      <p className="sub">AI interpretations are stored separately from deterministic KPI records and must expose their grounding.</p>
      {rows.length === 0 ? <div className="card"><p className="note">No AI insights stored.</p></div> : (
        <div className="grid">
          {rows.map((r) => (
            <article className="card" key={r.id}>
              <h2>{r.companyName} · {r.ticker}</h2>
              <p className="note">Thesis v{r.thesisVersion} · {r.role} · Score {r.score}/100 · Confidence {(r.confidence * 100).toFixed(0)}%</p>
              <p>{r.summary}</p>
              <p>{r.thesis}</p>
              <p className="note">Catalysts: {(r.catalysts ?? []).join(' · ') || '—'}</p>
              <p className="note">Risks: {(r.risks ?? []).join(' · ') || '—'}</p>
              <p className="caveat">Thesis breakers: {(r.breakers ?? []).join(' · ') || '—'}</p>
              <p className="note">Grounded in: {(r.groundedIn ?? []).join(', ') || 'INVALID — no grounding'}</p>
              <p className="note">{r.timestamp.toISOString()}</p>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
