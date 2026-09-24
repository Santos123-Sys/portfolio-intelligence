import { DiscoveryRunRequest, type SecurityUniverseRecord } from '@portfolio-intelligence/agentic-contract';

export function summarizeDiscoveryUniverse(records: SecurityUniverseRecord[]) {
  const byMarket = new Map<string, SecurityUniverseRecord[]>();
  for (const record of records) byMarket.set(record.exchange, [...(byMarket.get(record.exchange) ?? []), record]);
  return [...byMarket].map(([exchange, market]) => {
    const first = market[0];
    const rank = first.attributes.universe_ranking;
    const selection = rank === 'market_capitalization_desc' ? 'Largest market caps first'
      : rank === 'last_close_turnover' ? 'Highest recent traded value first'
        : rank === 'alphabetically_stratified_unranked' ? 'Spread across the symbol list; size was unavailable'
          : 'Unranked provider list; selection may omit major issuers';
    return {
      exchange, count: market.length, provider: first.provider,
      observedAt: market.reduce((earliest, record) => record.observedAt < earliest ? record.observedAt : earliest, first.observedAt),
      selection,
      limited: market.some((record) => record.attributes.universe_truncated === true || record.attributes.universe_limit_reached === true),
      eligibleCount: typeof first.attributes.universe_eligible_count === 'number' ? first.attributes.universe_eligible_count : null,
    };
  });
}

export function summarizeRunUniverse(request: unknown) {
  const parsed = DiscoveryRunRequest.safeParse(request);
  return parsed.success ? summarizeDiscoveryUniverse(parsed.data.universe) : [];
}
