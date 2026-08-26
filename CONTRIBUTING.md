# Working on this codebase

## The invariants

These are not style preferences. Breaking one produces numbers that look right and are not.

1. **`src/lib/quant/` must never import from `src/lib/agenteki/`.** The calculation
   layer is deterministic and independently testable. Adding an LLM call there
   collapses the entire architecture.

2. **No function may combine values across currencies** except
   `src/lib/fx/displayTotal()`. If you need a cross-currency figure for anything
   other than a cosmetic total, the answer is no — reconsider the requirement.

3. **Every risk function returns a `RiskMetric`, never a bare number.** A float
   with no methodology attached cannot be audited, and the dashboard is required
   to expose methodology on demand.

4. **`groundedIn` may never be empty.** An analysis grounded in nothing is an
   opinion. The schema enforces this; do not relax it.

5. **Agenteki must not run inside an HTTP request handler.** Enqueue a job, return
   202, let the cron worker execute it.

## Before opening a PR

```bash
npm test          # all 51 must pass
npm run typecheck
npm run build
```

If you add a quant function, add a test asserting against a value you calculated
by hand or in a spreadsheet. Tests that assert against the implementation's own
output verify nothing.
