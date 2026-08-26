'use client';

/**
 * Security Detail (Page 4) — Section 5.3. Four regions: Market &
 * Fundamentals, Position, AI Analysis, Grounding. The Grounding region is the
 * audit trail ADR-004 exists for: every metric name the AI analysis cites,
 * next to when the underlying data was as of.
 */
import { useEffect, useState } from 'react';
import { use as usePromise } from 'react';
import { usePortfolioBreadcrumb } from '@/lib/portfolio-context';

interface PositionDetail {
  id: string;
  portfolioId: string;
  portfolioName: string;
  securityId: string;
  ticker: string;
  companyName: string;
  exchange: string;
  currency: string;
  sector: string | null;
  country: string | null;
  isin: string | null;
  quantity: string | number;
  avgCost: string | number;
  marketValueNative: string | number | null;
  weight: number | null;
}

interface RiskMetricRow {
  id: string;
  metricName: string;
  value: number;
  currency: string;
  dataAsOf: string | null;
}

interface Analysis {
  id: string;
  portfolioCandidate: boolean;
  portfolioRole: string;
  investmentScore: number;
  thesisAlignmentScore: number;
  qualityScore: number | null;
  growthScore: number | null;
  riskScore: number | null;
  dividendScore: number | null;
  fundamentalSummary: string | null;
  investmentThesis: string | null;
  keyCatalysts: string[] | null;
  keyRisks: string[] | null;
  thesisBreakers: string[] | null;
  confidenceScore: number;
  groundedIn: string[] | null;
  analysisTimestamp: string;
  dataTimestamp: string | null;
  thesisVersionId: string;
}

interface FundamentalObservation {
  id: string;
  metricName: string;
  valueNumeric: string | null;
  valueText: string | null;
  observationDate: string | null;
  sourceName: string | null;
}

export default function SecurityDetailPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = usePromise(params);
  const { setViewing } = usePortfolioBreadcrumb();

  const [position, setPosition] = useState<PositionDetail | null>(null);
  const [metrics, setMetrics] = useState<RiskMetricRow[]>([]);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [fundamentals, setFundamentals] = useState<FundamentalObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const posRes = await fetch(`/api/positions?ticker=${encodeURIComponent(ticker)}`);
        if (!posRes.ok) throw new Error(`API returned ${posRes.status}`);
        const posData: { positions: PositionDetail[] } = await posRes.json();
        const pos = posData.positions[0] ?? null;
        if (cancelled) return;

        if (!pos) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        setPosition(pos);
        setViewing({ id: pos.portfolioId, name: pos.portfolioName, currency: pos.currency });

        const [riskRes, analysisRes, obsRes] = await Promise.all([
          fetch(`/api/risk?portfolioId=${pos.portfolioId}`),
          fetch(`/api/analysis?securityId=${pos.securityId}`),
          fetch(`/api/market-observations?securityId=${pos.securityId}`),
        ]);
        if (cancelled) return;

        if (riskRes.ok) setMetrics((await riskRes.json()).metrics ?? []);
        if (analysisRes.ok) setAnalyses((await analysisRes.json()).analyses ?? []);
        if (obsRes.ok) {
          const obsData: { observations: FundamentalObservation[] & { observationType?: string }[] } =
            await obsRes.json();
          setFundamentals(
            (obsData.observations as unknown as (FundamentalObservation & { observationType: string })[]).filter(
              (o) => o.observationType === 'fundamental'
            )
          );
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [ticker, setViewing]);

  if (error) {
    return (
      <main>
        <h1>{ticker}</h1>
        <div className="card">
          <p className="note">
            Connection failed: Unable to reach backend.
            <br />
            Check that the API is running and DATABASE_URL is set.
            <br />
            {error}
          </p>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main>
        <h1>{ticker}</h1>
        <p className="note">Fetching...</p>
      </main>
    );
  }

  if (notFound || !position) {
    return (
      <main>
        <h1>{ticker}</h1>
        <div className="card">
          <p className="note">No position found for this ticker. It may not be held in any seeded portfolio.</p>
        </div>
      </main>
    );
  }

  const latestAnalysis = analyses[0] ?? null;

  return (
    <main>
      <h1>{position.companyName} <span className="cur">{position.ticker}</span></h1>
      <p className="sub">{position.exchange} · {position.currency}</p>

      <div className="grid">
        {/* Region 1: Market & Fundamentals */}
        <div className="card">
          <h2>Market &amp; Fundamentals</h2>
          <table>
            <tbody>
              <tr><td>Sector</td><td className="num">{position.sector ?? '—'}</td></tr>
              <tr><td>Country</td><td className="num">{position.country ?? '—'}</td></tr>
              <tr><td>Exchange</td><td className="num">{position.exchange}</td></tr>
              <tr><td>ISIN</td><td className="num">{position.isin ?? '—'}</td></tr>
            </tbody>
          </table>
          {fundamentals.length === 0 ? (
            <p className="note">No fundamentals recorded yet.</p>
          ) : (
            <table style={{ marginTop: '0.75rem' }}>
              <tbody>
                {fundamentals.map((f) => (
                  <tr key={f.id}>
                    <td>{f.metricName}</td>
                    <td className="num">{f.valueNumeric ?? f.valueText ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Region 2: Position */}
        <div className="card">
          <h2>Position</h2>
          <table>
            <tbody>
              <tr><td>Portfolio</td><td className="num">{position.portfolioName}</td></tr>
              <tr><td>Quantity</td><td className="num">{Number(position.quantity).toLocaleString()}</td></tr>
              <tr><td>Avg Cost</td><td className="num">{Number(position.avgCost).toFixed(2)}<span className="cur">{position.currency}</span></td></tr>
              <tr><td>Market Value</td><td className="num">{position.marketValueNative == null ? '—' : Number(position.marketValueNative).toLocaleString(undefined, { maximumFractionDigits: 2 })}<span className="cur">{position.currency}</span></td></tr>
              <tr><td>Weight</td><td className="num">{position.weight == null ? '—' : `${(position.weight * 100).toFixed(2)}%`}</td></tr>
            </tbody>
          </table>
          {metrics.length > 0 && (
            <>
              <p className="note" style={{ marginTop: '0.75rem' }}>Portfolio-level risk context (not position-specific):</p>
              <table>
                <tbody>
                  {metrics.map((m) => (
                    <tr key={m.id}>
                      <td>{m.metricName}</td>
                      <td className="num">{m.value.toFixed(3)}<span className="cur">{m.currency}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        {/* Region 3: AI Analysis */}
        <div className="card">
          <h2>AI Analysis</h2>
          {!latestAnalysis ? (
            <p className="note">No imported analysis yet. Start an external run from the Agentic System workspace.</p>
          ) : (
            <>
              <p className="note">
                {latestAnalysis.portfolioRole} · Investment score {latestAnalysis.investmentScore}/100 · Thesis
                alignment {latestAnalysis.thesisAlignmentScore}/100
              </p>
              <p>{latestAnalysis.investmentThesis}</p>
              <p className="note">Quality {latestAnalysis.qualityScore ?? '—'} · Growth {latestAnalysis.growthScore ?? '—'} · Risk {latestAnalysis.riskScore ?? '—'} · Dividend {latestAnalysis.dividendScore ?? '—'}</p>
              <p className="note">Catalysts: {(latestAnalysis.keyCatalysts ?? []).join(' · ') || '—'}</p>
              <p className="note">Risks: {(latestAnalysis.keyRisks ?? []).join(' · ') || '—'}</p>
              <p className="caveat">Thesis breakers: {(latestAnalysis.thesisBreakers ?? []).join(' · ') || 'none'}</p>
              <p className="note">Confidence: {(latestAnalysis.confidenceScore * 100).toFixed(0)}%</p>
              <p className="note">Analyzed: {new Date(latestAnalysis.analysisTimestamp).toLocaleString()}</p>
              <p className="note">Thesis version: {latestAnalysis.thesisVersionId}</p>
            </>
          )}
        </div>

        {/* Region 4: Grounding — the audit trail */}
        <div className="card">
          <h2>Grounding</h2>
          {!latestAnalysis || (latestAnalysis.groundedIn ?? []).length === 0 ? (
            <p className="caveat">No grounding recorded — an analysis citing nothing should not be trusted.</p>
          ) : (
            <table>
              <thead><tr><th>Metric</th><th className="num">Data as of</th></tr></thead>
              <tbody>
                {(latestAnalysis.groundedIn ?? []).map((metricName) => (
                  <tr key={metricName}>
                    <td>{metricName}</td>
                    <td className="num">{latestAnalysis.dataTimestamp ? new Date(latestAnalysis.dataTimestamp).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}
