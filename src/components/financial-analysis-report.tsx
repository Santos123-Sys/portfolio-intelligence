'use client';

import { useEffect, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { FinancialAnalysisReport as Report } from '@/lib/financial-analysis-report';

const currencyValue = (value: number | undefined, currency: string) => value == null ? 'Unavailable'
  : new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
const percent = (value: number | null) => value == null ? 'Unavailable' : `${(value * 100).toFixed(1)}%`;

export function FinancialAnalysisReport({ candidateId, reloadToken }: { candidateId: string; reloadToken: number }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/discovery/financial-report?candidateId=${encodeURIComponent(candidateId)}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as Report & { error?: string };
        if (!response.ok) throw new Error(body.error ?? 'Financial report unavailable');
        setReport(body);
      }).catch((cause) => { if (!controller.signal.aborted) setError((cause as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [candidateId, reloadToken]);
  const series = report?.periods.map((period) => ({
    year: period.periodEnd.slice(0, 4), revenue: period.metrics.revenue ?? null,
    operatingIncome: period.metrics.operating_income ?? null, freeCashFlow: period.metrics.free_cash_flow ?? null,
  })) ?? [];
  return <section className="financial-report" aria-labelledby="financial-report-heading">
    <div className="financial-report-header"><div><p className="analysis-eyebrow">Source-backed financial analysis</p>
      <h4 id="financial-report-heading">Company financial report</h4>
      <p className="note">The report appears here after analysis. Downloading a PDF is optional.</p></div>
      {report && <a className="secondary-button" href={`/api/discovery/financial-report/pdf?candidateId=${encodeURIComponent(candidateId)}`}>Download PDF</a>}
    </div>
    {loading ? <p className="note" role="status">Loading financial evidence…</p> : error ? <p className="caveat" role="alert">{error}</p> : report && <>
      <p className="note">{report.companyName} · {report.ticker} · {report.currency} · {report.periods.length} annual periods · report generated {new Date(report.generatedAt).toLocaleDateString()}</p>
      {report.periods.length >= 2 && <div className="financial-chart" role="img" aria-label="Historical revenue, operating income, and free cash flow by annual period">
        <ResponsiveContainer width="100%" height={280}><LineChart data={series} margin={{ top: 12, right: 16, bottom: 8, left: 16 }}>
          <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="year" /><YAxis tickFormatter={(value: number) => new Intl.NumberFormat('en-US', { notation: 'compact' }).format(value)} />
          <Tooltip formatter={(value, name) => [currencyValue(typeof value === 'number' ? value : undefined, report.currency), String(name)]} />
          <Legend /><Line type="linear" dataKey="revenue" name="Revenue" stroke="#246B8E" connectNulls={false} />
          <Line type="linear" dataKey="operatingIncome" name="Operating income" stroke="#B88932" connectNulls={false} />
          <Line type="linear" dataKey="freeCashFlow" name="Free cash flow" stroke="#147D73" connectNulls={false} />
        </LineChart></ResponsiveContainer>
      </div>}
      {report.periods.length > 0 && <div className="table-scroll"><table><thead><tr><th>Annual period</th><th>Revenue</th><th>Growth</th><th>Operating margin</th><th>Net margin</th><th>FCF / revenue</th><th>Source and gaps</th></tr></thead>
        <tbody>{report.periods.map((period) => <tr key={period.periodEnd}><th>{period.periodEnd}</th>
          <td>{currencyValue(period.metrics.revenue, report.currency)}</td><td>{percent(period.revenueGrowth)}</td>
          <td>{percent(period.operatingMargin)}</td><td>{percent(period.netMargin)}</td><td>{percent(period.cashConversion)}</td>
          <td><a href={period.sourceUrl} target="_blank" rel="noopener noreferrer">{period.sourceName}</a>
            {period.gaps.length > 0 && <span className="financial-gaps">Missing: {period.gaps.join(', ')}</span>}</td></tr>)}</tbody></table></div>}
      {report.limitations.map((limitation) => <p className="caveat" key={limitation}>{limitation}</p>)}
    </>}
  </section>;
}
