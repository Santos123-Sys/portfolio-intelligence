import { NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/env';
import { withLock } from '@/lib/services/lock';
import { recomputeAll } from '@/lib/services/recompute';
import { getPriceProvider } from '@/lib/connectors';
import { db } from '@/lib/db';
import { securities, priceHistory, fxRates } from '@/lib/db/schema';
import { fetchEcbRates } from '@/lib/fx';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Daily refresh: prices -> FX -> recompute.
 *
 * Runs under a lock because Vercel Cron is at-least-once with no concurrency
 * guarantee. Two overlapping runs writing FX rates is exactly the silent
 * corruption this guards against.
 */
export async function GET(req: Request) {
  try {
    assertCronAuthorized(req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }

  const outcome = await withLock('daily_refresh', async () => {
    const provider = getPriceProvider();
    const allSecurities = await db.select().from(securities);

    let pricesWritten = 0;
    const priceErrors: string[] = [];
    for (const s of allSecurities) {
      try {
        const bar = await provider.getLatestPrice(s.ticker, s.exchange);
        if (!bar) continue;
        await db
          .insert(priceHistory)
          .values({
            securityId: s.id, priceDate: bar.date, close: String(bar.close),
            currency: bar.currency, source: provider.name,
          })
          .onConflictDoNothing();
        pricesWritten++;
      } catch (e) {
        priceErrors.push(`${s.ticker}: ${(e as Error).message}`);
      }
    }

    let fxWritten = 0;
    let fxError: string | null = null;
    try {
      const { rateDate, perEur } = await fetchEcbRates();
      for (const [cur, rate] of Object.entries(perEur)) {
        await db
          .insert(fxRates)
          .values({ fromCurrency: 'EUR', toCurrency: cur, rate: String(rate), rateDate, source: 'ECB' })
          .onConflictDoNothing();
        fxWritten++;
      }
    } catch (e) {
      fxError = (e as Error).message;
    }

    const recomputed = await recomputeAll();
    return { pricesWritten, priceErrors, fxWritten, fxError, recomputed };
  });

  if (!outcome.ran) {
    return NextResponse.json({ skipped: true, reason: outcome.reason }, { status: 200 });
  }
  return NextResponse.json({ ok: true, ...outcome.result });
}
