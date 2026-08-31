# Workflow and Navigation Correction Plan

## Problem

The application treated two different jobs as one readiness gate:

1. Discovering a potential investment from an approved thesis.
2. Analysing a portfolio of positions already owned.

That caused the setup page to require a position before discovery could begin. It is backwards: a position is the result of an investment decision, not an input to market research.

The navigation reinforced the error by putting the thesis and discovery workspaces under `More`, while lower-level monitoring pages occupied the primary navigation.

## Correct user journey

```text
1. Thesis
   Confirm objective, markets and selection criteria.
        ↓
2. Portfolio destination, only when needed
   Create or name the Swiss / Brazilian destination implied by the thesis.
        ↓
3. Discover
   Build the market universe and produce candidates. No position is created.
        ↓
4. Decide and analyse
   Approve, reject or watchlist candidates; analyse approved candidates.
        ↓
5. Portfolio
   Record a position only after the investor decides to invest.
        ↓
6. Monitor
   Review allocation, risk, performance and decision history.
```

## Applied changes

- Replaced the misleading `Analysis readiness` panel with a `Discovery setup` panel.
- Removed position requirements from the discovery path and made the next action explicit.
- Reframed the manual position form as post-decision / existing-holdings work.
- Made Thesis, Discover, Portfolio and Monitor the primary navigation sequence.
- Moved lower-frequency operational pages to `More`.
- Renamed the standalone agentic page to `Existing-Holdings Analysis` to prevent it from competing with the discovery workflow.

## Intentional remaining distinction

Existing-holdings analysis still requires positions, because it calculates and interprets the portfolio that is already owned. That rule is valid, but it must never block thesis-driven discovery.
