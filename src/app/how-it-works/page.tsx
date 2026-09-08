import Link from 'next/link';

export default function HowItWorksPage() {
  return <main>
    <h1>How Portfolio Intelligence works</h1>
    <p className="sub">A human-led investment research workflow. The system organizes evidence and calculations; it does not make investment decisions for you.</p>
    <div className="workflow-guide">
      <section className="card"><p className="analysis-eyebrow">1. Define</p><h2>Investment thesis</h2><p>Upload or create the mandate, then confirm the extracted criteria. The thesis determines what the research system is allowed to screen for.</p><Link className="action-button inline-action" href="/investment-thesis">Open thesis</Link></section>
      <section className="card"><p className="analysis-eyebrow">2. Discover</p><h2>Market research</h2><p>Build a provider-backed universe, apply mandate filters, and review only the candidates returned by that specific run. Approving a candidate starts research; it does not add a holding.</p><Link className="action-button inline-action" href="/ai-stock-discovery">Open discovery</Link></section>
      <section className="card"><p className="analysis-eyebrow">3. Analyze</p><h2>Research and risk</h2><p>Review catalysts, risks, information gaps, price-risk metrics, and the professional research report. Evidence gaps remain visible rather than becoming assumptions.</p><Link className="action-button inline-action" href="/research-history">Open research history</Link></section>
      <section className="card"><p className="analysis-eyebrow">4. Value</p><h2>DCF and comparables</h2><p>Retrieve primary-source financials, confirm DCF scenario inputs, and compare a reviewed peer group. Comparable data is sourced where available; peer selection remains your responsibility.</p><Link className="action-button inline-action" href="/ai-stock-discovery">Open valuation workspace</Link></section>
      <section className="card"><p className="analysis-eyebrow">5. Own and monitor</p><h2>Portfolio</h2><p>Add positions only after your decision. Portfolio risk appears once holdings and sufficient market history exist; it is separate from candidate-level research risk.</p><Link className="action-button inline-action" href="/positions">Open positions</Link></section>
    </div>
  </main>;
}
