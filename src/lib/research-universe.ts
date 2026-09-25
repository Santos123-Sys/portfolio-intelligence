import { SecurityUniverseRecord, type SecurityUniverseRecord as SecurityUniverseRecordType } from '@portfolio-intelligence/agentic-contract';
import seed from '../../data/research-universe/global-issuer-listing-snapshot-2026-09-25.json';

type SeedIssuer = (typeof seed.issuers)[number];
type SeedListing = (typeof seed.listings)[number];

const issuerByKey = new Map<string, SeedIssuer>(seed.issuers.map((issuer) => [issuer.issuerKey, issuer]));

// The application's current portfolio roles cover B3 and SIX. The rest of the
// global snapshot is retained as reference data until those markets are
// configured for discovery.
const DISCOVERY_SEED_EXCHANGES = new Set(['BVMF', 'XSWX']);

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/\.(SA|SW)$/, '');
}

function primaryListings(exchange: string): SeedListing[] {
  if (!DISCOVERY_SEED_EXCHANGES.has(exchange)) return [];
  return seed.listings.filter((listing) =>
    listing.mic === exchange && listing.status === 'Active' && listing.primaryListing === 'Yes'
  );
}

function researchAttributes(issuer: SeedIssuer, listing: SeedListing): SecurityUniverseRecordType['attributes'] {
  const attributes: SecurityUniverseRecordType['attributes'] = {
    issuer_key: issuer.issuerKey,
    issuer_id: issuer.issuerId,
    legal_name: issuer.legalName,
    issuer_lei: issuer.lei,
    issuer_domicile_country: issuer.domicileCountry,
    issuer_domicile_country_iso2: issuer.domicileCountryIso2,
    issuer_website: issuer.website,
    investor_relations_url: issuer.investorRelationsUrl,
    issuer_identity_source_url: issuer.identitySourceUrl,
    issuer_identity_observed_at: issuer.identityObservedAt,
    listing_id: listing.listingId,
    listing_mic: listing.mic,
    listing_country: listing.listingCountry,
    listing_country_iso2: listing.listingCountryIso2,
    listing_isin: listing.isin,
    listing_figi: listing.figi,
    listing_share_class: listing.shareClass,
    listing_security_type: listing.securityType,
    listing_primary_status: listing.primaryListing,
    listing_source_url: listing.sourceUrl,
    listing_observed_at: listing.observedAt,
    listing_data_quality_notes: listing.dataQualityNotes,
    openfigi_selected_matches_listing_figi: listing.openFigi.selectedFigiMatchesListingFigi,
    openfigi_response_candidate_count: listing.openFigi.returnedCandidateCount,
    openfigi_response_truncated: listing.openFigi.responseTruncated,
    research_seed_snapshot_date: seed.snapshotDate,
  };

  if (issuer.revenueGeography) {
    attributes.revenue_geo_status = issuer.revenueGeography.status;
    attributes.revenue_geo_summary = issuer.revenueGeography.summary;
    attributes.revenue_geo_period = issuer.revenueGeography.period;
    attributes.revenue_geo_source_url = issuer.revenueGeography.sourceUrl;
  }

  if (issuer.secFiler) {
    attributes.sec_filer_ticker = issuer.secFiler.ticker;
    attributes.sec_cik = issuer.secFiler.cik;
    attributes.sec_filer_name = issuer.secFiler.name;
    attributes.sec_annual_form = issuer.secFiler.form;
    attributes.sec_filing_date = issuer.secFiler.filingDate;
    attributes.sec_reporting_period = issuer.secFiler.period;
    attributes.sec_filing_source_url = issuer.secFiler.sourceUrl;
  }

  if (issuer.dataQualityNotes) attributes.issuer_data_quality_notes = issuer.dataQualityNotes;
  return attributes;
}

function seedRecord(listing: SeedListing, issuer: SeedIssuer): SecurityUniverseRecordType {
  return SecurityUniverseRecord.parse({
    ticker: normalizeTicker(listing.ticker),
    exchange: listing.mic,
    companyName: issuer.legalName,
    currency: listing.currency,
    country: listing.listingCountry,
    sector: null,
    industry: null,
    assetType: listing.securityType,
    observedAt: `${listing.observedAt}T00:00:00.000Z`,
    provider: 'research_seed',
    sourceUrl: listing.sourceUrl,
    attributes: researchAttributes(issuer, listing),
  });
}

/**
 * Adds the dated issuer/listing snapshot to supported-market universes.
 * Provider records remain canonical when present; seed-only listings are
 * appended so a small curated set can broaden coverage beyond provider ranking.
 */
export function mergeResearchUniverse(
  providerRecords: SecurityUniverseRecordType[],
  exchange: string,
): SecurityUniverseRecordType[] {
  const candidates = primaryListings(exchange);
  const listingByTicker = new Map(candidates.map((listing) => [normalizeTicker(listing.ticker), listing]));
  const included = new Set<string>();

  const enriched = providerRecords.map((record) => {
    const key = normalizeTicker(record.ticker);
    const listing = listingByTicker.get(key);
    const issuer = listing ? issuerByKey.get(listing.issuerKey) : undefined;
    if (!listing || !issuer) return record;

    included.add(key);
    return SecurityUniverseRecord.parse({
      ...record,
      attributes: {
        ...record.attributes,
        ...researchAttributes(issuer, listing),
      },
    });
  });

  const supplements = candidates.flatMap((listing) => {
    const key = normalizeTicker(listing.ticker);
    const issuer = issuerByKey.get(listing.issuerKey);
    return !included.has(key) && issuer ? [seedRecord(listing, issuer)] : [];
  });

  return [...enriched, ...supplements];
}

export const researchUniverseSnapshotSummary = seed.summary;

