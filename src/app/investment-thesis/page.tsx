import { desc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { thesisVersions } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export default async function InvestmentThesisPage() {
  const versions = await db.select().from(thesisVersions).orderBy(desc(thesisVersions.versionNumber));

  return (
    <main>
      <h1>Investment Thesis</h1>
      <p className="sub">Versioned source of investment rules, mandates and constraints.</p>
      {versions.length === 0 ? (
        <div className="card"><p className="note">No thesis versions exist yet. Thesis ingestion is the next write workflow.</p></div>
      ) : (
        <div className="grid">
          {versions.map((thesis) => (
            <article className="card" key={thesis.id}>
              <h2>Version {thesis.versionNumber}</h2>
              <p className="note">Effective: {thesis.effectiveDate.toISOString()}</p>
              <span className="badge">{thesis.supersededAt ? 'Superseded' : 'Active'}</span>
              <pre style={{ whiteSpace: 'pre-wrap', marginTop: '1rem', color: 'var(--muted)', fontSize: '0.75rem' }}>
                {JSON.stringify(thesis.criteriaJson, null, 2)}
              </pre>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
