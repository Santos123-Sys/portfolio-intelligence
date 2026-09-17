'use client';

/**
 * Security Detail (Page 4) — Section 5.3. Four regions: Market &
 * Fundamentals, Position, AI Analysis, Grounding. The Grounding region is the
 * audit trail ADR-004 exists for: every metric name the AI analysis cites,
 * next to when the underlying data was as of.
 */
import { useEffect, useState } from 'react';
import { use as usePromise } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { usePortfolioBreadcrumb } from '@/lib/portfolio-context';
import { diffAnalyses } from '@/lib/integrations/analysis-validation';

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
  researchFramework: {
    coverageRationale: string;
    marketContext: string[];
    sectorDrivers: string[];
    companyDrivers: string[];
    criticalValuationDrivers: string[];
    monitoringTriggers: string[];
    evidenceQuality: string;
    scenarioReadiness: string;
  } | null;
  confidenceScore: number;
  groundedIn: string[] | null;
  informationGaps: string[] | null;
  externalRunId: string | null;
  supersedesId: string | null;
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
  const searchParams = useSearchParams();
  const { setViewing } = usePortfolioBreadcrumb();

  const [position, setPosition] = useState<PositionDetail | null>(null);
  const [metrics, setMetrics] = useState<RiskMetricRow[]>([]);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [fundamentals, setFundamentals] = useState<FundamentalObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [viewerMode, setViewerMode] = useState(false);

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

        const [riskRes, analysisRes, obsRes, authRes] = await Promise.all([
          fetch(`/api/risk?portfolioId=${pos.portfolioId}`),
          fetch(`/api/analysis?securityId=${pos.securityId}`),
          fetch(`/api/market-observations?securityId=${pos.securityId}`),
          fetch('/api/auth/session'),
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
        if (authRes.ok) {
          const auth = await authRes.json() as { user?: { role?: string } };
          setViewerMode(auth.user?.role === 'viewer');
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

  const requestedAnalysisId = searchParams.get('analysis');
  const latestAnalysis = analyses.find((analysis) => analysis.id === requestedAnalysisId) ?? analyses[0] ?? null;
  const previousAnalysis = latestAnalysis?.supersedesId
    ? analyses.find((analysis) => analysis.id === latestAnalysis.supersedesId) ?? null
    : null;

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

        {/* Region 2: Position — client viewers receive a clean research report instead. */}
        {!viewerMode && <div className="card">
          <h2>Position</h2>
          <table>
            <tbody>
              <tr><td>Portfolio</td><td className="num">{position.portfolioName}</td></tr>
              <tr><td>Quantity</td><td className="num">{Number(position.quantity).toLocaleString()}</td></tr>
              <tr><td>Avg Cost</td><td className="num">{formatNativeCurrency(position.avgCost, position.currency)}</td></tr>
              <tr><td>Market Value</td><td className="num">{position.marketValueNative == null ? '—' : formatNativeCurrency(position.marketValueNative, position.currency)}</td></tr>
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
                      <td className="num">{m.currency} {m.value.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>}

        {/* Region 3: AI Analysis */}
        <div className="card">
          <h2>{viewerMode ? 'Investment research' : 'AI Analysis'}</h2>
          {!latestAnalysis ? (
            <p className="note">No imported analysis yet. Start an external run from the Agentic System workspace.</p>
          ) : (
            <>
              <div className={`analysis-confidence confidence-${confidenceBand(latestAnalysis.confidenceScore)}`}>
                <strong>{confidenceLabel(latestAnalysis.confidenceScore)}</strong>
                <span>{Math.round(latestAnalysis.confidenceScore * 100)}% evidence confidence</span>
              </div>
              <p className="note">
                {latestAnalysis.portfolioRole} · Investment score {latestAnalysis.investmentScore}/100 · Thesis alignment {latestAnalysis.thesisAlignmentScore}/100
              </p>
              {latestAnalysis.thesisAlignmentScore < 50 && <div className="thesis-gate" role="note"><strong>Thesis-fit gate active</strong><span>This analysis is capped by weak thesis alignment. Review the stated thesis breakers before treating the score as a recommendation.</span></div>}
              <p className="analysis-thesis">{latestAnalysis.investmentThesis}</p>
              <p className="note">Quality {latestAnalysis.qualityScore ?? '—'} · Growth {latestAnalysis.growthScore ?? '—'} · Risk {latestAnalysis.riskScore ?? '—'} · Dividend {latestAnalysis.dividendScore ?? '—'}</p>
              <p className="note">Catalysts: {(latestAnalysis.keyCatalysts ?? []).join(' · ') || '—'}</p>
              <p className="note">Risks: {(latestAnalysis.keyRisks ?? []).join(' · ') || '—'}</p>
              <p className="caveat"><strong>Thesis breakers:</strong> {(latestAnalysis.thesisBreakers ?? []).join(' · ') || 'No thesis breaker was supplied.'}</p>
              {latestAnalysis.researchFramework && <div className="research-framework">
                <div className="research-framework-heading">
                  <div>
                    <h4>Research framework</h4>
                    <p>Coverage rationale, drivers, and monitoring conditions.</p>
                  </div>
                  <div className="research-framework-badges">
                    <span className="badge">Evidence: {latestAnalysis.researchFramework.evidenceQuality.replaceAll('_', ' ')}</span>
                    <span className="badge">Scenarios: {latestAnalysis.researchFramework.scenarioReadiness.replaceAll('_', ' ')}</span>
                  </div>
                </div>
                <p><strong>Coverage rationale:</strong> {latestAnalysis.researchFramework.coverageRationale}</p>
                <p className="note"><strong>Sector drivers:</strong> {latestAnalysis.researchFramework.sectorDrivers.join(' · ') || 'Not evidenced'}</p>
                <p className="note"><strong>Company drivers:</strong> {latestAnalysis.researchFramework.companyDrivers.join(' · ') || 'Not evidenced'}</p>
                <p className="note"><strong>Monitoring triggers:</strong> {latestAnalysis.researchFramework.monitoringTriggers.join(' · ')}</p>
              </div>}
              {previousAnalysis && <AnalysisChanges previous={previousAnalysis} current={latestAnalysis} />}
              {!viewerMode && <AnalysisVerdict analysisId={latestAnalysis.id} />}
              <div className="analysis-report-links">
                {latestAnalysis.externalRunId && <a className="action-button inline-action" href={`/api/integrations/agentic/reports?externalRunId=${encodeURIComponent(latestAnalysis.externalRunId)}`} target="_blank" rel="noreferrer">Open PDF snapshot</a>}
                <Link className="text-link" href={`/security/${encodeURIComponent(ticker)}?analysis=${latestAnalysis.id}`}>Open this live analysis</Link>
              </div>
              <p className="note">Analyzed: {new Date(latestAnalysis.analysisTimestamp).toLocaleString()}</p>
              <p className="note">Thesis version: {latestAnalysis.thesisVersionId}</p>
            </>
          )}
        </div>

        {/* Region 4: Grounding — the audit trail. Viewer mode keeps only the report-facing explanation. */}
        <div className="card">
          <h2>Grounding</h2>
          {!latestAnalysis || (latestAnalysis.groundedIn ?? []).length === 0 ? (
            <p className="caveat">No grounding recorded — an analysis citing nothing should not be trusted.</p>
          ) : (
            <>
              <p className="note">Each item below is a retained evidence reference for this version. Source-to-sentence citation mapping is added only where the agent supplies it explicitly.</p>
              <div className="evidence-chips">{(latestAnalysis.groundedIn ?? []).map((metricName) => <details key={metricName} className="evidence-chip"><summary>{metricName}</summary><p>Data as of: {latestAnalysis.dataTimestamp ? new Date(latestAnalysis.dataTimestamp).toLocaleString() : 'timestamp unavailable'}</p></details>)}</div>
            </>
          )}
          {latestAnalysis?.informationGaps?.length ? <div className="information-gaps"><h3>Information still missing</h3><p className="note">These are explicit limits on the conclusion, not zeros or implied negatives.</p><ul>{latestAnalysis.informationGaps.map((gap) => <li key={gap}>{gap}</li>)}</ul></div> : <p className="note">No material information gap was reported for this analysis.</p>}
        </div>
      </div>
    </main>
  );
}

function formatNativeCurrency(value: string | number, currency: string) {
  return `${currency} ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function confidenceBand(score: number) {
  if (score < 0.5) return 'thin';
  if (score < 0.75) return 'moderate';
  return 'strong';
}

function confidenceLabel(score: number) {
  if (score < 0.5) return 'Thin data';
  if (score < 0.75) return 'Qualified evidence';
  return 'Well-supported evidence';
}

function AnalysisChanges({ previous, current }: { previous: Analysis; current: Analysis }) {
  const changes = diffAnalyses(previous as never, current as never);
  if (!changes.length) return null;
  return <section className="analysis-changes"><h3>What changed since the prior analysis</h3><ul>{changes.map((change) => <li key={change.field}><strong>{humanize(change.field)}:</strong> {formatChange(change.from)} → {formatChange(change.to)}</li>)}</ul></section>;
}

function humanize(field: string) { return field.replace(/([A-Z])/g, ' $1').replace(/^./, (value) => value.toUpperCase()); }
function formatChange(value: unknown) {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : `${Math.round(value * 100)}%`;
  if (typeof value === 'boolean') return value ? 'eligible' : 'not eligible';
  if (value == null) return 'not available';
  if (Array.isArray(value)) return value.join(' · ') || 'none recorded';
  return typeof value === 'object' ? 'research framework revised' : String(value);
}

function AnalysisVerdict({ analysisId }: { analysisId: string }) {
  const [rationale, setRationale] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(decision: 'accepted' | 'watchlist' | 'reanalysis_requested') {
    setBusy(true); setStatus(null);
    const response = await fetch('/api/candidates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ analysisId, decision, rationale: rationale || undefined }) }).catch(() => null);
    const body = await response?.json().catch(() => ({})) as { error?: string } | undefined;
    setStatus(response?.ok ? (decision === 'accepted' ? 'Agreement recorded in the decision log.' : decision === 'watchlist' ? 'Flagged for monitoring.' : 'Reanalysis request recorded.') : body?.error ?? 'Unable to record the review verdict.');
    setBusy(false);
  }
  return <section className="analysis-verdict"><h3>Human review</h3><p className="note">Record a verdict on this analysis. This is not an order or an automatic portfolio change.</p><input value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="Optional rationale for the record" aria-label="Optional review rationale" maxLength={1000} /><div><button type="button" onClick={() => void submit('accepted')} disabled={busy}>Agree</button><button type="button" className="secondary-action" onClick={() => void submit('reanalysis_requested')} disabled={busy}>Override / reanalyse</button><button type="button" className="secondary-action" onClick={() => void submit('watchlist')} disabled={busy}>Flag for monitoring</button></div>{status && <p className="note" role="status">{status}</p>}</section>;
}
