import { SecurityUniverseRecord } from '@portfolio-intelligence/agentic-contract';
import { describe, expect, it } from 'vitest';
import { mergeResearchUniverse, researchUniverseSnapshotSummary } from '../src/lib/research-universe';

describe('research universe snapshot', () => {
  it('preserves the researched coverage and unresolved input as an audit item', () => {
    expect(researchUniverseSnapshotSummary).toMatchObject({
      issuers: 86,
      listings: 90,
      markets: 11,
      leiPresent: 85,
      leiMissing: 1,
      isinPresent: 25,
      revenueGeographyDisclosed: 15,
      secFilerRecords: 35,
      openFigiSelectedMatchesListingFigi: 90,
      openFigiTruncatedResponses: 6,
      primaryListingUnknown: 1,
      unmatchedTickerInputs: ['ROG.SW'],
    });
  });

  it('enriches matching provider records and adds only supported-market primary listings', () => {
    const providerRecord = SecurityUniverseRecord.parse({
      ticker: 'PETR3',
      exchange: 'BVMF',
      companyName: 'Petrobras',
      currency: 'BRL',
      country: 'Brazil',
      sector: null,
      industry: null,
      assetType: 'Common Stock',
      observedAt: '2026-09-25T12:00:00.000Z',
      provider: 'finnhub',
      sourceUrl: 'https://finnhub.io/docs/api/stock-symbols',
      attributes: { provider_symbol: 'PETR3.SA', figi: 'provider-figi' },
    });

    const merged = mergeResearchUniverse([providerRecord], 'BVMF');
    const enriched = merged.find((record) => record.ticker === 'PETR3');

    expect(merged).toHaveLength(8);
    expect(enriched).toMatchObject({ provider: 'finnhub', sourceUrl: providerRecord.sourceUrl });
    expect(enriched?.attributes).toMatchObject({
      issuer_key: 'PETROBRAS',
      issuer_domicile_country: 'Brazil',
      listing_country: 'Brazil',
      listing_figi: 'BBG000BFTBL4',
      figi: 'provider-figi',
      listing_primary_status: 'Yes',
      research_seed_snapshot_date: '2026-09-25',
    });
    expect(mergeResearchUniverse([], 'XSWX')).toHaveLength(8);
    expect(mergeResearchUniverse([], 'XETR')).toHaveLength(0);
  });

  it('keeps revenue geography absent when the snapshot has no cited disclosure', () => {
    const roche = mergeResearchUniverse([], 'XSWX').find((record) => record.ticker === 'RO');
    expect(roche?.attributes).not.toHaveProperty('revenue_geo_summary');
    expect(roche?.attributes).toMatchObject({
      issuer_domicile_country: 'Switzerland',
      listing_country: 'Switzerland',
    });
  });
});
