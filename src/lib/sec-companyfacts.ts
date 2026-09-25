import type { InvestorRelationsFundamentals } from './investor-relations';

const SEC_ORIGIN = 'https://data.sec.gov';
const REGISTRY_URL = 'https://www.sec.gov/files/company_tickers.json';
const METRICS: Record<string, string[]> = {
  revenue: ['us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 'us-gaap:Revenues', 'ifrs-full:Revenue'],
  gross_profit: ['us-gaap:GrossProfit', 'ifrs-full:GrossProfit'],
  operating_income: ['us-gaap:OperatingIncomeLoss', 'ifrs-full:ProfitLossFromOperatingActivities'],
  operating_cash_flow: ['us-gaap:NetCashProvidedByUsedInOperatingActivities', 'ifrs-full:CashFlowsFromUsedInOperatingActivities'],
  capital_expenditure: ['us-gaap:PaymentsToAcquirePropertyPlantAndEquipment'],
  cash_and_equivalents: ['us-gaap:CashAndCashEquivalentsAtCarryingValue', 'ifrs-full:CashAndCashEquivalents'],
  total_debt: ['us-gaap:LongTermDebt', 'us-gaap:LongTermDebtNoncurrent'],
  total_equity: ['us-gaap:StockholdersEquity', 'ifrs-full:Equity'],
  net_income: ['us-gaap:NetIncomeLoss', 'ifrs-full:ProfitLoss'],
  shares_outstanding: ['dei:EntityCommonStockSharesOutstanding'],
};

type SecFact = { val: number; start?: string; end: string; accn: string; filed: string; form: string; fy?: number; fp?: string };
type SecCompanyFacts = { cik: number; entityName: string; facts: Record<string, Record<string, { units: Record<string, SecFact[]> }>> };

function normalized(value: string) { return value.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
function issuerMatches(expected: string, actual: string) {
  const meaningful = normalized(expected).split(' ').filter((part) => part.length >= 4 && !['HOLDING', 'HOLDINGS', 'GROUP', 'CORPORATION', 'COMPANY', 'LIMITED'].includes(part));
  return meaningful.some((part) => normalized(actual).split(' ').includes(part));
}
function annual(fact: SecFact, unit: string) {
  if (!Number.isFinite(fact.val) || !/^\d{4}-\d{2}-\d{2}$/.test(fact.end) || !/^\d{10}-\d{2}-\d{6}$/.test(fact.accn)) return false;
  if (!['10-K', '20-F', '40-F'].includes(fact.form) || fact.fp !== 'FY') return false;
  if (unit === 'shares') return !fact.start;
  if (!fact.start) return true; // balance-sheet instant
  const days = (Date.parse(fact.end) - Date.parse(fact.start)) / 86_400_000;
  return days >= 330 && days <= 380;
}

/** Preserve distinct filing accessions; never mix a restatement and an older filing. */
export function extractSecAnnualFilings(data: SecCompanyFacts, companyName: string, currency: string): InvestorRelationsFundamentals[] {
  if (!issuerMatches(companyName, data.entityName)) return [];
  type FilingGroup = { end: string; accn: string; filed: string; metrics: Record<string, number>; ambiguous: Set<string> };
  const byFiling = new Map<string, FilingGroup>();
  for (const [metric, tags] of Object.entries(METRICS)) {
    for (const tag of tags) {
      const [taxonomy, name] = tag.split(':');
      const units = data.facts?.[taxonomy]?.[name]?.units;
      const unit = metric === 'shares_outstanding' ? 'shares' : currency;
      for (const fact of units?.[unit] ?? []) {
        if (!annual(fact, unit)) continue;
        const key = `${fact.end}:${fact.accn}`;
        const group = byFiling.get(key) ?? { end: fact.end, accn: fact.accn, filed: fact.filed, metrics: {}, ambiguous: new Set<string>() };
        if (group.ambiguous.has(metric)) continue;
        if (group.metrics[metric] != null && group.metrics[metric] !== fact.val) {
          delete group.metrics[metric]; // conflicting tags in one filing cannot be resolved by size
          group.ambiguous.add(metric);
          continue;
        }
        group.metrics[metric] = fact.val;
        byFiling.set(key, group);
      }
    }
  }
  const latest = new Map<string, FilingGroup>();
  for (const group of byFiling.values()) {
    const previous = latest.get(group.end);
    if (!previous || group.filed > previous.filed || group.filed === previous.filed && group.accn > previous.accn) latest.set(group.end, group);
  }
  return [...latest.values()].sort((a, b) => a.end.localeCompare(b.end)).slice(-5).flatMap((group) => {
    if (!Object.keys(group.metrics).length) return [];
    const fundamentals = { ...group.metrics };
    if (fundamentals.operating_cash_flow != null && fundamentals.capital_expenditure != null)
      fundamentals.free_cash_flow = fundamentals.operating_cash_flow - Math.abs(fundamentals.capital_expenditure);
    return [{ fundamentals, currency, periodEnd: group.end,
      sourceUrl: `${SEC_ORIGIN}/api/xbrl/companyfacts/CIK${String(data.cik).padStart(10, '0')}.json`,
      sourceName: `SEC Company Facts · ${data.entityName} · ${group.accn}`,
      evidenceSnippet: `SEC annual filing ${group.accn}, filed ${group.filed}. Period ending ${group.end}; ${currency}. Review the underlying filing and accounting scope.`,
    }];
  });
}

async function secJson(url: string, userAgent: string): Promise<unknown> {
  const response = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000), redirect: 'error', cache: 'no-store' });
  if (!response.ok) throw new Error(`SEC request returned HTTP ${response.status}`);
  const size = Number(response.headers.get('content-length'));
  if (size > 15_000_000) throw new Error('SEC payload exceeds 15 MB');
  const body = await response.text();
  if (body.length > 15_000_000) throw new Error('SEC payload exceeds 15 MB');
  return JSON.parse(body);
}

export async function retrieveSecAnnualFilings(companyName: string, ticker: string, currency: string) {
  if (currency !== 'USD') return [];
  const userAgent = process.env.SEC_USER_AGENT?.trim();
  if (!userAgent || userAgent.length < 12 || !userAgent.includes('@')) throw new Error('SEC_USER_AGENT must identify an organization and contact email');
  const registry = await secJson(REGISTRY_URL, userAgent) as Record<string, { cik_str: number; ticker: string; title: string }>;
  const matches = Object.values(registry).filter((item) => item.ticker?.toUpperCase() === ticker.toUpperCase());
  if (matches.length !== 1 || !issuerMatches(companyName, matches[0].title)) return [];
  const cik = matches[0].cik_str;
  if (!Number.isSafeInteger(cik) || cik < 1) return [];
  const data = await secJson(`${SEC_ORIGIN}/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`, userAgent) as SecCompanyFacts;
  if (data.cik !== cik) return [];
  return extractSecAnnualFilings(data, companyName, currency);
}
