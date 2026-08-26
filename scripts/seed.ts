/**
 * Demo seed. Creates two portfolios, six securities, positions, a thesis, and
 * 400 days of stub price history so the quant engine has something real to chew.
 *
 * Every price row is tagged source='stub' so no figure derived from it can be
 * mistaken for market data.
 */
import { db } from '../src/lib/db';
import { portfolios, securities, positions, thesisVersions, priceHistory } from '../src/lib/db/schema';
import { StubProvider } from '../src/lib/connectors/stub';

const SECURITIES = [
  { ticker: 'NESN', companyName: 'Nestlé S.A.', exchange: 'XSWX', currency: 'CHF', sector: 'Consumer Staples', country: 'CH', qty: 120, cost: 92.4 },
  { ticker: 'ROG', companyName: 'Roche Holding AG', exchange: 'XSWX', currency: 'CHF', sector: 'Health Care', country: 'CH', qty: 45, cost: 248.1 },
  { ticker: 'NOVN', companyName: 'Novartis AG', exchange: 'XSWX', currency: 'CHF', sector: 'Health Care', country: 'CH', qty: 80, cost: 96.7 },
  { ticker: 'WEGE3', companyName: 'WEG S.A.', exchange: 'BVMF', currency: 'BRL', sector: 'Industrials', country: 'BR', qty: 900, cost: 38.2 },
  { ticker: 'RADL3', companyName: 'Raia Drogasil S.A.', exchange: 'BVMF', currency: 'BRL', sector: 'Consumer Staples', country: 'BR', qty: 1400, cost: 24.6 },
  { ticker: 'TOTS3', companyName: 'TOTVS S.A.', exchange: 'BVMF', currency: 'BRL', sector: 'Technology', country: 'BR', qty: 1100, cost: 31.9 },
];

async function main() {
  console.log('Seeding…');

  const [swiss] = await db.insert(portfolios).values({
    name: 'Swiss Quality & Stability', portfolioType: 'swiss_quality', baseCurrency: 'CHF',
    investmentObjective: 'Capital preservation and stable compounding via high-quality Swiss businesses',
  }).returning();

  const [brazil] = await db.insert(portfolios).values({
    name: 'Brazilian Growth', portfolioType: 'brazilian_growth', baseCurrency: 'BRL',
    investmentObjective: 'Capital appreciation via structurally growing Brazilian businesses',
  }).returning();

  await db.insert(thesisVersions).values({
    versionNumber: 1,
    criteriaJson: {
      version: 1,
      portfolios: [
        { role: 'swiss_quality', currency: 'CHF',
          objective: 'Capital preservation with stable compounding',
          inclusionCriteria: ['Durable competitive advantage', 'Consistent free cash flow', 'Conservative balance sheet', 'Reliable dividend'],
          exclusionCriteria: ['Loss-making', 'Net debt/EBITDA above 3x', 'Governance concerns'] },
        { role: 'brazilian_growth', currency: 'BRL',
          objective: 'Capital appreciation from structural growth',
          inclusionCriteria: ['Revenue growth above 12% over 3 years', 'Expanding addressable market', 'Founder or long-tenured management'],
          exclusionCriteria: ['Heavy state ownership', 'Single-customer concentration above 30%'] },
      ],
      globalConstraints: ['No position above 15% of its portfolio', 'No leverage', 'No derivatives'],
    },
  });

  const provider = new StubProvider();
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);

  for (const s of SECURITIES) {
    const [sec] = await db.insert(securities).values({
      ticker: s.ticker, companyName: s.companyName, exchange: s.exchange,
      currency: s.currency, sector: s.sector, country: s.country,
    }).returning();

    await db.insert(positions).values({
      portfolioId: s.exchange === 'XSWX' ? swiss.id : brazil.id,
      securityId: sec.id, quantity: String(s.qty), avgCost: String(s.cost),
    });

    const bars = await provider.getDailyBars(s.ticker, s.exchange, from, to);
    for (let i = 0; i < bars.length; i += 200) {
      await db.insert(priceHistory).values(
        bars.slice(i, i + 200).map((b) => ({
          securityId: sec.id, priceDate: b.date, close: String(b.close),
          currency: b.currency, source: 'stub',
        }))
      ).onConflictDoNothing();
    }
    console.log(`  ${s.ticker}: ${bars.length} price rows`);
  }

  console.log('\nDone. Next: curl http://localhost:3000/api/cron/refresh');
}

main().catch((e) => { console.error(e); process.exit(1); });
