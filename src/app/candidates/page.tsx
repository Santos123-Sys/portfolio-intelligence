import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { aiAnalyses, securities } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export default async function CandidatesPage() {
  const candidates = await db
    .select({
      id: aiAnalyses.id,
      ticker: securities.ticker,
      companyName: securities.companyName,
      country: securities.country,
      sector: securities.sector,
      role: aiAnalyses.portfolioRole,
      investmentScore: aiAnalyses.investmentScore,
      thesisAlignment: aiAnalyses.thesisAlignmentScore,
      quality: aiAnalyses.qualityScore,
      growth: aiAnalyses.growthScore,
      dividend: aiAnalyses.dividendScore,
      risk: aiAnalyses.riskScore,
      confidence: aiAnalyses.confidenceScore,
      thesis: aiAnalyses.investmentThesis,
      risks: aiAnalyses.keyRisks,
      breakers: aiAnalyses.thesisBreakers,
    })
    .from(aiAnalyses)
    .innerJoin(securities, eq(aiAnalyses.securityId, securities.id))
    .where(eq(aiAnalyses.portfolioCandidate, true))
    .orderBy(desc(aiAnalyses.investmentScore));

  return (
    <main>
      <h1>Candidates</h1>
      <p className="sub">Human review queue. Acceptance into the portfolio remains outside the AI.</p>
      {candidates.length === 0 ? <div className="card"><p className="note">No portfolio candidates are currently qualified.</p></div> : (
        <table>
          <thead><tr><th>Company</th><th>Role</th><th className="num">Score</th><th className="num">Thesis</th><th className="num">Quality</th><th className="num">Growth</th><th className="num">Dividend</th><th className="num">Risk</th><th className="num">Confidence</th></tr></thead>
          <tbody>{candidates.map((c) => (
            <tr key={c.id}>
              <td><strong>{c.companyName}</strong><br /><span className="note">{c.ticker} · {c.country ?? '—'} · {c.sector ?? '—'}</span></td>
              <td>{c.role}</td>
              <td className="num">{c.investmentScore}</td>
              <td className="num">{c.thesisAlignment}</td>
              <td className="num">{c.quality ?? '—'}</td>
              <td className="num">{c.growth ?? '—'}</td>
              <td className="num">{c.dividend ?? '—'}</td>
              <td className="num">{c.risk ?? '—'}</td>
              <td className="num">{(c.confidence * 100).toFixed(0)}%</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </main>
  );
}
