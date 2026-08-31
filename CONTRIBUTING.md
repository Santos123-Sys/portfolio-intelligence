# Working on this codebase

## Repository ownership boundary

- Dashboard work owns the repository root, `src/**`, `scripts/**`, `drizzle/**`
  and `railway.toml`.
- Agentic-system work owns only `services/agentic/**`.
- Cross-boundary changes require an explicit contract proposal first; neither
  service writes directly into the other's database.

## The invariants

These are not style preferences. Breaking one produces numbers that look right and are not.

1. **`src/lib/quant/` must never import from `src/lib/integrations/`.** The calculation
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

5. **The dashboard must never run agent prompts.** It starts and polls the
   separately deployed agentic service, validates its callback, and imports the
   manifest transactionally.

## The merge gate

`.github/workflows/security.yml` runs the dependency audit, lint, typecheck,
tests and the production build on every pull request. It only *gates* a merge if
the repository requires it, which is a setting, not a file — GitHub does not read
branch protection from the repository.

To require it: **Settings → Branches → Add branch ruleset** (or edit the existing
rule) for `main`, enable **Require status checks to pass before merging**, and add
**`verify`** to the required checks. Enable **Require branches to be up to date
before merging** alongside it, otherwise a PR that was green against a stale base
can still break `main`.

`verify` is the job name in the workflow, and that name is what the rule matches
on. `tests/ci-gate.test.ts` pins it: renaming the job without updating the rule
would silently detach the gate, and there is no warning from GitHub when it
happens.

## Before opening a PR

```bash
npm test
npm run typecheck
npm run build
```

If you add a quant function, add a test asserting against a value you calculated
by hand or in a spreadsheet. Tests that assert against the implementation's own
output verify nothing.
