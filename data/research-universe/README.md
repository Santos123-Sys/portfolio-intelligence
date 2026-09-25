# Research universe snapshot

`global-issuer-listing-snapshot-2026-09-25.json` is a normalized, dated snapshot assembled from the supplied issuer, listing, GLEIF, OpenFIGI, revenue-geography, SEC-filing, and ticker-list research files. It contains 86 issuers and 90 listings in 11 listing countries.

## Runtime use

Discovery currently supports the B3 (`BVMF`) and SIX Swiss Exchange (`XSWX`) portfolio markets. For those markets, the snapshot enriches a matching live provider record with issuer and listing identifiers, distinct domicile and listing-country fields, cited revenue-geography disclosures when available, SEC filer metadata when available, and source dates and URLs. Active primary listings missing from the provider's ranked result are appended as additional research candidates. This can add up to eight records per supported market; the runtime does not expand discovery to the other nine markets in this snapshot.

The original provider record remains the canonical record when a ticker matches. Snapshot facts are added under explicit `issuer_*`, `listing_*`, `revenue_geo_*`, and `sec_*` attribute names. A listing country is never used as issuer domicile, and revenue geography is added only for the 15 issuers with a dated disclosure and source URL in this snapshot. Missing revenue-geography data means “not sourced here,” not “the issuer does not disclose it.”

## Coverage and review notes

- 85 of 86 issuers have an LEI; 40 have an investor-relations URL.
- 25 of 90 listings have an ISIN in the supplied listing data. Missing ISINs remain null.
- 15 issuers have revenue-geography disclosures; 35 have SEC annual-filer metadata.
- The selected OpenFIGI result's FIGI matches the listing FIGI for all 90 rows. Six OpenFIGI responses reached the 100-result page limit and include a continuation token; those are marked `responseTruncated` and should not be treated as exhaustive searches.
- The listing notes say “OpenFIGI mapping unresolved” for 84 rows even though the supplied OpenFIGI payload has a selected result matching the listing FIGI. Both the original notes and the raw mapping evidence are retained so this source-ledger inconsistency can be reviewed rather than silently rewritten.
- `ROG.SW` is present in the union of the two ticker lists but has no matching row in the 90-row listing table. It is recorded in the snapshot summary as an unmatched ticker and is not promoted to a listing.
- One listing (`AIR.DE`) has unknown primary-listing status; `0005.HK` is marked as a non-primary listing. Neither is selected as a primary discovery seed.
- SEC filing filesystem paths from the research workspace are omitted. Public SEC URLs, filer CIKs, form types, filing dates, and reporting periods are retained.

This is a research seed, not a live master-data service. Refresh it with a new dated source snapshot and review the quality flags before replacing it. Historical values and identities should be interpreted as of each row's observation or reporting date.
