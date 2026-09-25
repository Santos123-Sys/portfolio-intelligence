# Financial-analysis filing architecture

## Decision and deployment boundary

The dashboard remains Next.js with authenticated route handlers; the agentic worker runs long research jobs. The deployed quantitative engines remain TypeScript. The Python reference engines are not production inputs until schema contracts and parity fixtures establish equivalence. Recharts, already installed, renders the first interactive financial charts. Do not introduce FastAPI, pandas, numpy, Plotly, Chart.js, sec-api, or generic Scrapy crawling merely to replicate deployed capabilities.

A separate Python/FastAPI worker becomes appropriate when a verified, bounded batch ingestion workload needs Python parsing libraries. It must expose versioned JSON schemas, identify a filing by regulator and issuer identifier, enforce source-level provenance, and pass golden-fixture parity against the deployed calculations before influencing DCF or comparable-company analysis.

## Source order per market

| Market | Preferred source | Identity key | Fallback |
| --- | --- | --- | --- |
| US filer | SEC EDGAR Company Facts and submissions APIs | CIK, verified against issuer/ticker | SEC inline XBRL filing with matching context |
| Brazilian issuer | CVM DFP and ITR structured open data | CVM code / CNPJ, verified against issuer | Issuer filings with auditable context |
| Swiss issuer | Issuer annual report / structured investor-relations filing | Issuer identity plus ISIN | Human-reviewed annual filing; PDF extraction is quarantined |

A Swiss security trading in another market is routed by its issuer/filing identity, not by exchange alone. An ASML SIX listing is not evidence that ASML files with the Swiss regulator. A US listing likewise does not by itself establish a CIK.

The SEC documents its JSON XBRL APIs at https://www.sec.gov/search-filings/edgar-application-programming-interfaces and automated access guidance at https://www.sec.gov/about/developer-resources. CVM publishes DFP at https://dados.cvm.gov.br/dataset/cia_aberta-doc-dfp and ITR at https://dados.cvm.gov.br/dataset/cia_aberta-doc-itr. Provider use must respect published access terms and caching guidance.

## Ingestion contract

Each financial fact needs: issuer identifier, ticker/ISIN linkage, source URL, filing identifier, original taxonomy/tag, fiscal start and end (or instant), fiscal year, annual/quarterly classification, consolidated/individual scope, accounting standard, unit, currency, numeric value, retrieval date, and restatement/version state. Preserve source facts separately from derived ratios and forecasts. Do not merge a quarter with an annual duration, a standalone statement with a consolidated statement, or BRL with CHF/USD. Resolve duplicated and amended filings deterministically; unresolved conflicts are gaps, not estimates.

The current `market_data_observations` table has `observationDate`, `currency`, `sourceUrl`, and `rawPayload`; a dedicated normalized filing/fact schema is required for complete multi-year analysis. The present inline-XBRL import now requires an explicit annual context and matching currency, excludes segmented contexts and conflicting metrics, and records its reporting end date. It remains a narrow fallback and cannot deliver a full historical series or PDF-only coverage.

## Financial-analysis workflow

1. Resolve issuer and source; show verified identifiers and the filing selected.
2. Ingest dated income statement, balance sheet, and cash-flow facts with taxonomy mappings and completeness checks.
3. Normalize annual and quarterly observations; distinguish reported, derived, estimate, and unavailable.
4. Calculate revenue growth, margins, ROIC, cash conversion, leverage, reinvestment, and share dilution only from compatible facts. Record exact input fact IDs and formula version.
5. Display interactive historical charts with year, native currency, report basis, filing links, and gaps. Charts never interpolate unavailable periods silently.
6. Show a review screen for conflicting/restated periods and a human approval gate for assumptions and peer selection.
7. Feed the same reviewed fact set into DCF and Comps, with explicit warnings for missing drivers and a reproducible report snapshot.

## Implementation sequence and acceptance gates

- PR A (this change): fail-closed inline-XBRL period/unit selection and dated provenance. Fixture tests cover old-year, quarter, mixed currency and duplicate facts.
- PR B: official SEC Company Facts adapter with verified CIK, bounded requests, caching and filing-level facts. SEC coverage is conditional on a verified US filing identity.
- PR C: CVM DFP/ITR ingestion keyed by issuer identity, with consolidated statement selection, annual/quarter separation, restatement handling and Brazilian fixtures.
- PR D: Swiss issuer source registry with structured-filing adapters; PDF parsing requires issuer-specific fixtures and human reconciliation.
- PR E: normalized facts, time-series analysis and Recharts panels, followed by DCF/Comps handoff tests against the same approved facts.
- PR F only if justified by measured throughput: Python batch worker, pandas/numpy and FastAPI contract. Deploy separately on Railway after parity, observability and authentication gates pass.

A source failure, unknown reporting period, unit mismatch, missing issuer match, or ambiguous filing keeps valuation locked for that metric. The UI must show the concrete missing evidence and never imply that search results or scraped snippets are audited financial figures.

## CVM DFP import

For a BVMF/BRL candidate, enter the issuer's 14-digit CNPJ and one DFP fiscal year in the valuation workspace. The app fetches the official CVM annual archive for that year, extracts bounded consolidated DRE, DFC and balance-sheet CSVs, verifies the CNPJ and company name, selects the latest filing revision, normalizes the reported scale to BRL, and retains the archive URL, year and revision. It does not infer debt, capex or free cash flow from ambiguous line items, and therefore may leave DCF locked. Import further years individually to build historical coverage. Quarterly ITR normalization is a separate follow-up because its cumulative figures cannot be compared directly with annual flows.
