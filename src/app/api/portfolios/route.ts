import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { portfolios, positions } from '@/lib/db/schema';
import { eq, sum } from 'drizzle-orm';
import { fetchEcbRates, displayTotal } from '@/lib/fx';
import { Currency } from '@/lib/quant/types';

export const runtime = 'nodejs';

/**
 * Returns each portfolio with its NATIVE-currency total, plus an optional
 * display-only converted grand total when ?displayCurrency= is supplied.
 *
 * The two are deliberately separate keys in the response. A client that ignores
 * `displayTotal` still gets correct, unblended figures.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const displayCurrency = url.searchParams.get('displayCurrency') as Currency | null;

  const rows = await db
    .select({
      id: portfolios.id,
      name: portfolios.name,
      portfolioType: portfolios.portfolioType,
      baseCurrency: portfolios.baseCurrency,
      investmentObjective: portfolios.investmentObjective,
      totalValueNative: sum(positions.marketValueNative),
    })
    .from(portfolios)
    .leftJoin(positions, eq(positions.portfolioId, portfolios.id))
    .groupBy(portfolios.id);

  const items = rows.map((r) => ({
    ...r,
    totalValueNative: Number(r.totalValueNative ?? 0),
  }));

  if (!displayCurrency) {
    return NextResponse.json({ portfolios: items, displayTotal: null });
  }

  try {
    const { rateDate, perEur } = await fetchEcbRates();
    const total = displayTotal(
      items.map((p) => ({
        portfolioId: p.id,
        name: p.name,
        valueNative: p.totalValueNative,
        currency: p.baseCurrency as Currency,
      })),
      displayCurrency,
      perEur,
      rateDate
    );
    return NextResponse.json({ portfolios: items, displayTotal: total });
  } catch (e) {
    // FX failure must never block native figures.
    return NextResponse.json({
      portfolios: items,
      displayTotal: null,
      displayTotalError: (e as Error).message,
    });
  }
}
