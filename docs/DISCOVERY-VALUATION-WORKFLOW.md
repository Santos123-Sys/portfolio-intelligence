# Thesis-Driven Discovery and Valuation

## Implemented workflow

```mermaid
flowchart TD
  A[Confirmed thesis] --> B[Provider market universe]
  B --> C[Market research shortlist]
  C --> D{Human decision}
  D -->|Approve| E[One-security evidence retrieval]
  D -->|Watch or reject| F[No analysis]
  E --> G[Top-down grounded analysis]
  E --> H[Deterministic risk]
  G --> I[Human-confirmed assumptions]
  H --> I
  I --> J[Deterministic DCF and fair value]
```

The pre-existing thesis extraction, portfolio-monitoring analysis, manifest,
PDF, authentication and Railway services remain intact. Opportunity discovery
is a separate state machine so a research candidate is never confused with a
held position.

## Non-negotiable controls

- A discovery result is rejected if its ticker is absent from the
  dashboard-supplied provider universe.
- The market-research model may rank and interpret supplied fields; it cannot
  calculate a new financial metric.
- A candidate receives no financial analysis until the owner explicitly
  approves it.
- Approval creates or links a security reference only. It does not create a
  position, transaction or trade.
- Approved candidates are processed as independent one-security runs.
- Every financial claim must cite an exact supplied grounding key.
- Volatility, drawdown, historical VaR and parametric VaR are computed from the
  provider price series by TypeScript.
- DCF arithmetic is deterministic. The owner must review the method and confirm
  every growth, discount, terminal-growth, net-debt and share-count assumption.
- Standard FCFF DCF is flagged as a method mismatch for financial institutions
  and real-estate vehicles.

## Agent personalization

`/agent-settings` versions four configurations: thesis extraction, market
research, security analysis and portfolio synthesis. Owners can edit the role
name, scope and prompt addendum. Tool access is a whitelist: document,
structured universe and grounding tools are mandatory for their stages; hosted
web search is enabled by default and can be disabled only for market research.

The protected reasoning layer adapts the platform-configuration sections of the
provided thesis-extraction, market-discovery and financial-analysis prompt
documents to the current validated output schemas. Prompt order is immutable
service policy, then protected source-derived reasoning, then owner scope and
owner addendum. Customization cannot disable grounding validation, enable LLM
arithmetic, grant database access, add trade execution or bypass human
approval.

The supplied DCF and risk prompts are displayed separately as deterministic
engine policies. They are not LLM agents: TypeScript performs their arithmetic,
and human-confirmed inputs plus code invariants remain authoritative.

The market researcher can use the OpenAI Responses API hosted `web_search` tool
when enabled. Candidate identities still must exist in the EODHD structured
universe, and retrieved sources must survive URL validation. OpenAI documents
that web-search output includes source metadata and citation annotations:
<https://developers.openai.com/api/docs/guides/tools-web-search>.

## Market-data setup

Railway needs these project/environment shared secrets:

```text
OPENAI_API_KEY=<secret>
MARKET_DATA_API_KEY=<EODHD token>
```

The dashboard service receives:

```text
MARKET_DATA_PROVIDER=eodhd
MARKET_DATA_API_KEY=${{shared.MARKET_DATA_API_KEY}}
```

The adapter uses EODHD's global Screener for a bounded research universe, then
its Fundamentals and End-of-Day endpoints after human approval. EODHD documents
that screener filters are combined with AND, results are paginated, returned
values use the listing currency, and missing fields can exclude securities:
<https://eodhd.com/financial-apis/stock-market-screener-api>.

## Expected UI sequence

1. Create Swiss Quality and/or Brazilian Growth portfolios.
2. Configure agent preferences under **Agent Settings**.
3. Upload the thesis under **Investment Thesis**, review the extraction and
   explicitly confirm it.
4. Confirmation automatically starts market research for that exact thesis
   version and opens **AI Stock Discovery**. If EODHD, a matching portfolio, or
   the private agentic service is unavailable, the confirmed thesis is kept and
   the page displays the precise blocked prerequisite; the manual discovery
   button remains the retry path.
5. Review sources, gaps and thesis fit for every shortlisted security.
6. Approve, watchlist or reject each security.
7. Wait for an approved candidate's independent financial analysis.
8. Review standalone risk metrics and their methodology.
9. Open valuation, confirm the source fields and enter judgmental assumptions.
10. Calculate and review the DCF fair-value scenario and sensitivity caveats.

The final result is analytical decision support, not an execution instruction or
professional financial advice.
