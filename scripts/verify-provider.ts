/**
 * Empirical coverage check for a market-data provider.
 *
 *   npx tsx scripts/verify-provider.ts            # checks stooq (keyless)
 *   npx tsx scripts/verify-provider.ts stooq
 *   MARKET_DATA_API_KEY=... npx tsx scripts/verify-provider.ts eodhd
 *
 * ADR-005 has stayed open since the beginning for one reason: nobody has
 * confirmed that a candidate vendor actually covers SIX Swiss (XSWX) and B3
 * (BVMF), as opposed to listing them on a marketing page. This script answers
 * that by fetching real tickers on both exchanges and printing what came
 * back. Run it from somewhere with open outbound network access — a Railway
 * shell, or a laptop. It needs no database and no API key.
 *
 * It also probes alternative symbol suffixes when the configured one fails,
 * because Stooq's suffixes are country-based and undocumented; the output
 * tells you what to put in STOOQ_SUFFIX rather than leaving you to guess.
 *
 * Exit code is 0 only when every required exchange returned usable data, so
 * this is safe to gate a deployment on.
 */

import {
  COVERAGE_PROBES,
  STOOQ_SUFFIX,
  parseStooqCsv,
  stooqSymbol,
} from '../src/lib/connectors/stooq';
import { REQUIRED_EXCHANGES } from '../src/lib/connectors/base';
import { EodhdProvider } from '../src/lib/connectors/eodhd';

const ALTERNATIVE_SUFFIXES: Record<string, string[]> = {
  XSWX: ['.CH', '.SW', '.CHF', ''],
  BVMF: ['.BR', '.SA', '.B3', ''],
  XNAS: ['.US', ''],
  XNYS: ['.US', ''],
};

async function tryFetch(symbol: string): Promise<{ ok: boolean; rows: number; detail: string }> {
  const url = `https://stooq.com/q/d/l/?s=${symbol}&i=d`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, rows: 0, detail: `HTTP ${res.status}` };
    const csv = await res.text();
    try {
      const bars = parseStooqCsv(csv, 'XXX', symbol);
      if (bars.length === 0) return { ok: false, rows: 0, detail: 'CSV parsed but held no usable rows' };
      const last = bars[bars.length - 1];
      return { ok: true, rows: bars.length, detail: `latest ${last.date} close ${last.close}` };
    } catch (e) {
      return { ok: false, rows: 0, detail: (e as Error).message.slice(0, 110) };
    }
  } catch (e) {
    return { ok: false, rows: 0, detail: `request failed: ${(e as Error).message.slice(0, 80)}` };
  }
}

async function main(): Promise<number> {
  const provider = process.argv[2] ?? 'stooq';
  if (provider === 'eodhd') return verifyEodhd();
  if (provider !== 'stooq') {
    console.error(`Verifiable providers: stooq, eodhd. Received: ${provider}`);
    return 1;
  }

  console.log('Provider coverage check — stooq');
  console.log(`Required exchanges: ${REQUIRED_EXCHANGES.join(', ')}`);
  console.log('='.repeat(72));

  const covered = new Set<string>();
  const suffixFindings: Record<string, string> = {};
  const controlExchanges = new Set(
    COVERAGE_PROBES.filter((p) => /control/i.test(p.note)).map((p) => p.exchange)
  );

  for (const probe of COVERAGE_PROBES) {
    const configured = stooqSymbol(probe.ticker, probe.exchange);
    const result = await tryFetch(configured);
    const label = `${probe.ticker} (${probe.exchange}) — ${probe.note}`;

    if (result.ok) {
      console.log(`  PASS  ${label}\n        ${configured}: ${result.rows} rows, ${result.detail}`);
      covered.add(probe.exchange);
      continue;
    }

    console.log(`  FAIL  ${label}\n        ${configured}: ${result.detail}`);

    // The configured suffix did not work. Find out whether another one does,
    // so the failure report names the fix instead of just the problem.
    const alternatives = (ALTERNATIVE_SUFFIXES[probe.exchange] ?? []).filter(
      (s) => s !== STOOQ_SUFFIX[probe.exchange]
    );
    for (const suffix of alternatives) {
      const candidate = `${probe.ticker}${suffix}`.toLowerCase();
      const alt = await tryFetch(candidate);
      if (alt.ok) {
        console.log(`        -> '${suffix || '(no suffix)'}' WORKS: ${candidate}, ${alt.detail}`);
        suffixFindings[probe.exchange] = suffix;
        covered.add(probe.exchange);
        break;
      }
    }
  }

  console.log('='.repeat(72));

  if (Object.keys(suffixFindings).length > 0) {
    console.log('\nSTOOQ_SUFFIX needs correcting in src/lib/connectors/stooq.ts:');
    for (const [exchange, suffix] of Object.entries(suffixFindings)) {
      console.log(`  ${exchange}: '${STOOQ_SUFFIX[exchange]}' -> '${suffix}'`);
    }
  }

  // The control is a listing Stooq is known to carry. If even that failed,
  // the run says nothing about coverage — the network, a proxy or Stooq
  // itself is the problem, and reporting "not covered" here would be a
  // confidently wrong diagnosis that could get a working vendor discarded.
  const controlPassed = [...controlExchanges].some((e) => covered.has(e));
  if (!controlPassed) {
    console.log(
      `\nRESULT: INCONCLUSIVE. The control probe failed too, so every request\n` +
        `failed for a reason unrelated to exchange coverage — a blocked network,\n` +
        `an egress proxy, or Stooq being down. This run says NOTHING about whether\n` +
        `Stooq covers ${REQUIRED_EXCHANGES.join(' or ')}. Re-run from a machine with\n` +
        `open outbound access before drawing any conclusion.`
    );
    return 1;
  }

  const missing = REQUIRED_EXCHANGES.filter((e) => !covered.has(e));
  if (missing.length > 0) {
    console.log(
      `\nRESULT: NOT USABLE. No working symbol found for: ${missing.join(', ')}.\n` +
        `Stooq does not cover ${missing.join('/')} under any suffix tried. Keep\n` +
        `MARKET_DATA_PROVIDER on 'stub' and use a keyed provider (Twelve Data's\n` +
        `free tier lists both exchanges) — see docs/decision-log.md ADR-005.`
    );
    return 1;
  }

  console.log(
    `\nRESULT: USABLE for ${REQUIRED_EXCHANGES.join(' and ')}.\n` +
      (Object.keys(suffixFindings).length > 0
        ? `Apply the STOOQ_SUFFIX corrections above first, then set\n`
        : `Set `) +
      `MARKET_DATA_PROVIDER=stooq. Note this is prices only — Stooq publishes no\n` +
      `fundamentals, so the Agenteki grounding bundle will carry computed metrics\n` +
      `without fundamental fields until a fundamentals source is added.`
  );
  return 0;
}

/**
 * EODHD is the provider main actually wires in, and it is keyed — so the same
 * question ADR-005 asks of Stooq applies to it and has never been answered
 * either. This path exercises the real EodhdProvider rather than a hand-rolled
 * URL, so a passing run confirms the provider as configured, not merely that
 * the vendor has the data somewhere.
 */
async function verifyEodhd(): Promise<number> {
  const apiKey = process.env.MARKET_DATA_API_KEY;
  if (!apiKey) {
    console.error(
      'MARKET_DATA_API_KEY is required to verify eodhd.\n' +
        'Run: MARKET_DATA_API_KEY=... npx tsx scripts/verify-provider.ts eodhd'
    );
    return 1;
  }

  console.log('Provider coverage check — eodhd');
  console.log(`Required exchanges: ${REQUIRED_EXCHANGES.join(', ')}`);
  console.log('='.repeat(72));

  const eodhd = new EodhdProvider(apiKey);
  const covered = new Set<string>();
  const controlExchanges = new Set(
    COVERAGE_PROBES.filter((p) => /control/i.test(p.note)).map((p) => p.exchange)
  );

  for (const probe of COVERAGE_PROBES) {
    const label = `${probe.ticker} (${probe.exchange}) — ${probe.note}`;
    try {
      const bar = await eodhd.getLatestPrice(probe.ticker, probe.exchange);
      if (bar) {
        console.log(`  PASS  ${label}\n        latest ${bar.date} close ${bar.close} ${bar.currency}`);
        covered.add(probe.exchange);
      } else {
        console.log(`  FAIL  ${label}\n        provider returned no bar`);
      }
    } catch (e) {
      console.log(`  FAIL  ${label}\n        ${(e as Error).message.slice(0, 140)}`);
    }
  }

  console.log('='.repeat(72));

  if (![...controlExchanges].some((e) => covered.has(e))) {
    console.log(
      `\nRESULT: INCONCLUSIVE. The control probe failed too, so every request failed\n` +
        `for a reason unrelated to coverage — a bad key, an exhausted quota, or a\n` +
        `blocked network. This run says NOTHING about EODHD's SIX/B3 coverage.`
    );
    return 1;
  }

  const missing = REQUIRED_EXCHANGES.filter((e) => !covered.has(e));
  if (missing.length > 0) {
    console.log(
      `\nRESULT: NOT USABLE on this plan. No data for: ${missing.join(', ')}.\n` +
        `EODHD lists these exchanges, so this is most likely a subscription-tier\n` +
        `limit rather than absent data — check what your plan covers before\n` +
        `concluding the vendor is wrong.`
    );
    return 1;
  }

  console.log(
    `\nRESULT: USABLE for ${REQUIRED_EXCHANGES.join(' and ')} on this key.\n` +
      `ADR-005 can be closed on this evidence.`
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
