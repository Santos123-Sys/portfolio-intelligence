import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { aiAnalyses, securities, thesisVersions } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export default async function AIStockDiscoveryPage() {
  const rows = await db
    .select({
      id: aiAnalyses.id,
      ticker: securities.ticker,
      companyName: securities.companyName,
      country: securities.country,
      sector: securities.sector,
      role: aiAnalyses.portfolioRole,
      investmentScore: aiAnalyses.investmentScore,
      thesisAlignmentScore: aiAnalyses.thesisAlignmentScore,
      confidence: aiAnalyses.confidenceScore,
      portfolioCandidate: aiAnalyses.portfolioCandidate,
      thesis: aiAnalyses.investmentThesis,
      risks: aiAnalyses.keyRisks,
      breakers: aiAnalyses.thesisBreakers,
      analyzedAt: aiAnalyses.analysisTimestamp,
      thesisVersion: thesisVersions.versionNumber,
    })
    .from(aiAnalyses)
    .innerJoin(securities, eq(aiAnalyses.securityId, securities.id))
    .innerJoin(thesisVersions, eq(aiAnalyses.thesisVersionId, thesisVersions.id))
    .orderBy(desc(aiAnalyses.analysisTimestamp));

  return (
    <main>
      <h1>AI Stock Discovery</h1>
      <p className="sub">Thesis → analysis → thesis alignment → score → human review. AI does not calculate portfolio KPIs.</p>
      {rows.length === 0 ? <div className="card"><p className="note">No AI analyses are stored yet.</p></div> : (
        <div className="grid">
          {rows.map((r) => (
            <article className="card" key={r.id}>
              <h2>{r.companyName} · {r.ticker}</h2>
              <p className="note">{r.country ?? '—'} · {r.sector ?? '—'} · Thesis v{r.thesisVersion}</p>
              <p><strong>{r.investmentScore}/100</strong> investment score · {r.thesisAlignmentScore}/100 thesis alignment</p>
              <p className="note">Confidence: {(r.confidence * 100).toFixed(0)}% · Role: {r.role}</p>
              <span className="badge">{r.portfolioCandidate ? 'Portfolio Candidate' : 'Analysis'}</span>
              <p>{r.thesis}</p>
              <p className="note">Risks: {(r.risks ?? []).join(' · ') || 'None recorded'}</p>
              <p className="caveat">Thesis breakers: {(r.breakers ?? []).join(' · ') || 'None recorded'}</p>
              <p className="note">Analyzed {r.analyzedAt.toISOString()}</p>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
