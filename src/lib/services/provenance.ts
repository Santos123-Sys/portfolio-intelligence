import { db } from '../db';
import { marketDataObservations } from '../db/workflow-schema';
import { DailyBar, Fundamentals } from '../connectors';

export async function recordPriceObservation(securityId: string, bar: DailyBar, provider: string) {
  await db.insert(marketDataObservations).values({
    securityId,
    observationType: 'price',
    metricName: 'close',
    valueNumeric: String(bar.close),
    valueText: null,
    currency: bar.currency,
    observationDate: bar.date,
    provider: bar.provenance?.provider ?? provider,
    sourceName: bar.provenance?.sourceName,
    sourceUrl: bar.provenance?.sourceUrl,
    query: bar.provenance?.query,
    status: bar.provenance?.status ?? 'OK',
    evidenceSnippet: bar.provenance?.evidenceSnippet,
    rawPayload: bar.provenance?.rawPayload as any,
  });
}

export async function recordUnavailableObservation(
  securityId: string,
  observationType: 'price' | 'fundamental' | 'search_evidence',
  metricName: string,
  provider: string,
  status = 'DATA_UNAVAILABLE',
  query?: string,
  evidenceSnippet?: string
) {
  await db.insert(marketDataObservations).values({
    securityId,
    observationType,
    metricName,
    provider,
    status,
    query,
    evidenceSnippet,
  });
}

export async function recordFundamentalObservations(securityId: string, fundamentals: Fundamentals, provider: string) {
  const sourceName = typeof fundamentals._source === 'string' ? fundamentals._source : undefined;
  const sourceUrl = typeof fundamentals._sourceUrl === 'string' ? fundamentals._sourceUrl : undefined;
  const query = typeof fundamentals._query === 'string' ? fundamentals._query : undefined;
  const status = typeof fundamentals._status === 'string' ? fundamentals._status : 'OK';
  const evidenceSnippet = typeof fundamentals._evidenceSnippet === 'string' ? fundamentals._evidenceSnippet : undefined;

  for (const [metricName, value] of Object.entries(fundamentals)) {
    if (metricName.startsWith('_')) continue;
    await db.insert(marketDataObservations).values({
      securityId,
      observationType: 'fundamental',
      metricName,
      valueNumeric: typeof value === 'number' ? String(value) : null,
      valueText: typeof value === 'string' ? value : null,
      provider,
      sourceName,
      sourceUrl,
      query,
      status,
      evidenceSnippet,
    });
  }

  if (Object.keys(fundamentals).filter((k) => !k.startsWith('_')).length === 0) {
    await recordUnavailableObservation(securityId, 'fundamental', 'fundamentals', provider, status, query, evidenceSnippet);
  }
}
