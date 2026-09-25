# Swiss annual PDF extraction service

Deploy as a **private** Railway service using `railway.filings-python.json` from the repository root. The dashboard must reference its private URL in `FILINGS_API_URL` and share the same random `FILINGS_INTERNAL_TOKEN` (at least 32 characters). Set `OPENAI_API_KEY` on this service; optionally set `FILINGS_EXTRACTION_MODEL` to a PDF-capable model with structured output support. Do not add a public Railway domain.

The authenticated dashboard accepts PDFs up to 5 MB from an approved Swiss/CHF candidate, verifies their static structure, and forwards them to this service. The model proposes only sourced facts with a page and excerpt; Python/pandas checks annual duration, unit, currency and numerical bounds, and calculates draft ratios. Neither the model nor Python approves a fact. The dashboard retains the PDF and draft for owner review. Selected facts alone are inserted atomically into market observations, and the original PDF remains available through an authenticated route. At most ten PDF drafts are retained per candidate.

The existing portfolio report is the mandatory on-screen output (PR #77); its optional PDF is a separate download. This service has no market-data or trading permission.

Local deterministic test: `python3 -m unittest services.filings_python.test_analysis`. The live OpenAI extraction requires service credentials and a real issuer PDF; no inference is made from an absent live test.
