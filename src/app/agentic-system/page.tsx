import { desc, eq, asc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agentRuns, agentSteps } from '@/lib/db/agentic-schema';
import { securities } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export default async function AgenticSystemPage() {
  const runs = await db.select({
    id: agentRuns.id,
    status: agentRuns.status,
    ticker: securities.ticker,
    companyName: securities.companyName,
    startedAt: agentRuns.startedAt,
    completedAt: agentRuns.completedAt,
    orchestratorVersion: agentRuns.orchestratorVersion,
    errorMessage: agentRuns.errorMessage,
  }).from(agentRuns)
    .innerJoin(securities, eq(agentRuns.securityId, securities.id))
    .orderBy(desc(agentRuns.startedAt)).limit(20);

  const latest = runs[0];
  const steps = latest
    ? await db.select().from(agentSteps).where(eq(agentSteps.runId, latest.id)).orderBy(asc(agentSteps.sequence))
    : [];

  return (
    <main>
      <h1>Agentic Investment System</h1>
      <p className="sub">
        Orchestrated specialist agents interpret thesis, evidence, fundamentals and deterministic risk metrics before a critic challenges the case and an investment-committee agent synthesizes the final analysis.
      </p>

      <div className="card">
        <h2>Operating boundary</h2>
        <p>Agents reason and explain. The quant engine calculates. The database records. You decide.</p>
        <p className="note">No agent can execute trades or become the numerical source of truth.</p>
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <h2>Agent graph</h2>
        <p className="note">Thesis Interpreter → Research Evidence → Fundamental Analyst → Risk Interpreter → Portfolio Fit → Critic → Investment Committee</p>
      </div>

      {latest && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h2>Latest run · {latest.companyName} · {latest.ticker}</h2>
          <p><span className="badge">{latest.status}</span> <span className="note">{latest.orchestratorVersion}</span></p>
          {latest.errorMessage && <p className="caveat">{latest.errorMessage}</p>}
          {steps.length === 0 ? <p className="note">No completed agent steps persisted yet.</p> : (
            <table>
              <thead><tr><th>#</th><th>Agent</th><th>Status</th><th>Recorded</th></tr></thead>
              <tbody>
                {steps.map((s) => (
                  <tr key={s.id}>
                    <td>{s.sequence}</td>
                    <td>{s.agentName}</td>
                    <td>{s.status}</td>
                    <td>{s.createdAt.toISOString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="card" style={{ marginTop: '1rem' }}>
        <h2>Recent runs</h2>
        {runs.length === 0 ? <p className="note">No agentic analyses have run yet. Queue a security analysis to create the first trace.</p> : (
          <table>
            <thead><tr><th>Security</th><th>Status</th><th>Started</th><th>Completed</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{r.companyName} · {r.ticker}</td>
                  <td>{r.status}</td>
                  <td>{r.startedAt.toISOString()}</td>
                  <td>{r.completedAt?.toISOString() ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
