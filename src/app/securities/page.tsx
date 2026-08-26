import { asc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { securities } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export default async function SecuritiesPage() {
  const rows = await db.select().from(securities).orderBy(asc(securities.companyName));

  return (
    <main>
      <h1>Securities</h1>
      <p className="sub">Security master for the investable universe and portfolio holdings.</p>
      {rows.length === 0 ? <div className="card"><p className="note">No securities stored.</p></div> : (
        <table>
          <thead><tr><th>Company</th><th>Ticker</th><th>Country</th><th>Exchange</th><th>Currency</th><th>Sector</th><th>Industry</th></tr></thead>
          <tbody>{rows.map((s) => (
            <tr key={s.id}>
              <td><strong>{s.companyName}</strong></td>
              <td>{s.ticker}</td>
              <td>{s.country ?? '—'}</td>
              <td>{s.exchange}</td>
              <td>{s.currency}</td>
              <td>{s.sector ?? '—'}</td>
              <td>{s.industry ?? '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </main>
  );
}
