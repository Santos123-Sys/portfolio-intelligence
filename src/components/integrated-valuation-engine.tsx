'use client';

import { useState } from 'react';
import { calculateIntegratedComps, calculateIntegratedDcf, type IntegratedDcfInput, type IntegratedPeer } from '@/lib/quant/integrated-valuation';

type Tab = 'summary' | 'comps' | 'dcf' | 'sensitivity';

interface LabState {
  companyName: string;
  ticker: string;
  currency: string;
  currentPrice: number;
  peers: IntegratedPeer[];
  dcf: IntegratedDcfInput;
}

const techPeers = [
  ['Alpha Cloud', 'ALPH', 142, 720, 5400, 3100, 18400, 5400, 2800],
  ['Beta Systems', 'BETA', 88, 960, 7200, 2100, 22200, 4600, 1900],
  ['Core Networks', 'CORE', 216, 410, 3900, 1800, 12100, 3200, 1450],
  ['DataSphere', 'DATA', 64, 1300, 6100, 2400, 19800, 3900, 1180],
  ['Evergreen Tech', 'EVRG', 175, 510, 1800, 2600, 14600, 4200, 2300],
  ['Future Logic', 'FLOG', 103, 830, 4800, 1700, 16900, 3600, 1500],
];

const industrialPeers = [
  ['Apex Components', 'APEX', 76, 820, 2900, 700, 9200, 1250, 610],
  ['Bridge Manufacturing', 'BRDG', 118, 540, 3300, 900, 11400, 1580, 750],
  ['Crown Equipment', 'CRWN', 94, 690, 2500, 510, 7800, 1040, 480],
  ['Delta Controls', 'DLTA', 153, 390, 2100, 1300, 8600, 1480, 690],
  ['Eastline Group', 'EAST', 57, 1100, 4100, 1200, 13100, 1710, 710],
  ['Foundry Works', 'FNDY', 131, 470, 2800, 650, 10100, 1390, 620],
];

function sample(kind: 'tech' | 'industrials'): LabState {
  const rows = kind === 'tech' ? techPeers : industrialPeers;
  const peers = rows.map(([companyName, ticker, sharePrice, dilutedShares, totalDebt, cash, revenue, ebitda, netIncome], index) => ({
    id: `${kind}-${index}`, companyName: String(companyName), ticker: String(ticker), sharePrice: Number(sharePrice), dilutedShares: Number(dilutedShares),
    totalDebt: Number(totalDebt), cash: Number(cash), revenue: Number(revenue), ebitda: Number(ebitda), netIncome: Number(netIncome), included: true,
  }));
  const base: IntegratedDcfInput = {
    riskFreeRate: 0.042, marketRiskPremium: 0.052, beta: kind === 'tech' ? 1.12 : 0.92,
    costOfDebt: 0.058, taxRate: 0.21, debtToCapital: 0.22,
    baseRevenue: kind === 'tech' ? 12800 : 8900, baseEbitdaMargin: kind === 'tech' ? 0.25 : 0.145,
    daPercent: kind === 'tech' ? 0.045 : 0.052, capexPercent: kind === 'tech' ? 0.055 : 0.048, nwcPercent: 0.012,
    revenueGrowth: kind === 'tech' ? [0.12, 0.11, 0.1, 0.085, 0.07] : [0.065, 0.06, 0.055, 0.05, 0.045],
    ebitdaMargin: kind === 'tech' ? [0.255, 0.26, 0.265, 0.27, 0.27] : [0.15, 0.155, 0.16, 0.16, 0.16],
    capexPercentForecast: Array(5).fill(kind === 'tech' ? 0.055 : 0.048) as number[],
    nwcPercentForecast: Array(5).fill(0.012) as number[],
    perpetuityGrowthRate: 0.025, exitMultiple: 12,
    targetDebt: kind === 'tech' ? 3800 : 2500, targetCash: kind === 'tech' ? 2200 : 900,
    dilutedShares: kind === 'tech' ? 1200 : 680,
    targetNetIncome: kind === 'tech' ? 1400 : 520,
  };
  return { companyName: kind === 'tech' ? 'Sample Technology Co.' : 'Sample Industrials Co.', ticker: kind === 'tech' ? 'SAMP' : 'SIND', currency: 'USD', currentPrice: kind === 'tech' ? 74 : 52, peers, dcf: base };
}

function Field({ label, value, onChange, step = 'any', suffix = '', disabled = false }: { label: string; value: number; onChange: (value: number) => void; step?: string; suffix?: string; disabled?: boolean }) {
  return <label className="engine-field">{label}<span className="engine-field-control"><input type="number" inputMode="decimal" step={step} value={Number.isFinite(value) ? value : ''} disabled={disabled} onChange={(event) => onChange(event.target.value === '' ? 0 : Number(event.target.value))} /><small>{suffix}</small></span></label>;
}

function pct(value: number): string { return `${(value * 100).toFixed(1)}%`; }
function amount(currency: string, value: number | null, decimals = 1): string { return value == null || !Number.isFinite(value) ? 'N/A' : `${currency} ${value.toLocaleString(undefined, { maximumFractionDigits: decimals })}`; }

export function IntegratedValuationEngine() {
  const [model, setModel] = useState<LabState>(() => sample('tech'));
  const [tab, setTab] = useState<Tab>('summary');
  const [useCompsMedian, setUseCompsMedian] = useState(true);
  const comps = calculateIntegratedComps(model.peers);
  const linkedExitMultiple = useCompsMedian ? comps.evEbitda.median : null;
  const dcf = calculateIntegratedDcf(model.dcf, linkedExitMultiple, useCompsMedian);
  const updateDcf = (key: keyof IntegratedDcfInput, value: number | number[]) => setModel((current) => ({ ...current, dcf: { ...current.dcf, [key]: value } }));
  const updateYear = (key: 'revenueGrowth' | 'ebitdaMargin' | 'capexPercentForecast' | 'nwcPercentForecast', index: number, value: number) => setModel((current) => ({ ...current, dcf: { ...current.dcf, [key]: current.dcf[key].map((item, year) => year === index ? value : item) } }));
  const bestAvailable = [dcf.perpetuityPerShare, dcf.exitPerShare, ...comps.evEbitda.median != null ? [(comps.evEbitda.median * model.dcf.baseRevenue * model.dcf.baseEbitdaMargin - model.dcf.targetDebt + model.dcf.targetCash) / model.dcf.dilutedShares] : []].filter((value): value is number => value != null && Number.isFinite(value));
  const valuationLow = bestAvailable.length ? Math.min(...bestAvailable) : null;
  const valuationHigh = bestAvailable.length ? Math.max(...bestAvailable) : null;
  const rangeFor = (values: Array<number | null>) => {
    const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
    return valid.length ? { low: Math.min(...valid), high: Math.max(...valid) } : null;
  };
  const dcfGrowthRange = rangeFor(dcf.sensitivities.filter((cell) => close(cell.exitMultiple, linkedExitMultiple ?? model.dcf.exitMultiple) && Math.abs(cell.wacc - dcf.wacc) <= 0.010001 && Math.abs(cell.growth - model.dcf.perpetuityGrowthRate) <= 0.005001).map((cell) => cell.perpetuityPerShare));
  const dcfExitRange = rangeFor(dcf.sensitivities.filter((cell) => close(cell.growth, model.dcf.perpetuityGrowthRate) && Math.abs(cell.wacc - dcf.wacc) <= 0.010001 && Math.abs(cell.exitMultiple - (linkedExitMultiple ?? model.dcf.exitMultiple)) <= 2.001).map((cell) => cell.exitPerShare));
  const compsEbitdaRange = rangeFor([comps.evEbitda.low, comps.evEbitda.high].map((multiple) => multiple == null ? null : (multiple * model.dcf.baseRevenue * model.dcf.baseEbitdaMargin - model.dcf.targetDebt + model.dcf.targetCash) / model.dcf.dilutedShares));
  const compsRevenueRange = rangeFor([comps.evRevenue.low, comps.evRevenue.high].map((multiple) => multiple == null ? null : (multiple * model.dcf.baseRevenue - model.dcf.targetDebt + model.dcf.targetCash) / model.dcf.dilutedShares));
  const compsPeRange = rangeFor([comps.pe.low, comps.pe.high].map((multiple) => multiple == null ? null : multiple * model.dcf.targetNetIncome / model.dcf.dilutedShares));
  const footballRanges = [
    { label: 'DCF · Perpetuity growth sensitivity', range: dcfGrowthRange },
    { label: 'DCF · Exit multiple sensitivity', range: dcfExitRange },
    { label: 'Comps · EV / EBITDA peer range', range: compsEbitdaRange },
    { label: 'Comps · EV / Revenue peer range', range: compsRevenueRange },
    { label: 'Comps · P / E peer range', range: compsPeRange },
    { label: 'Current share price', range: { low: model.currentPrice, high: model.currentPrice } },
  ];
  const footballDomain = rangeFor(footballRanges.flatMap(({ range }) => range ? [range.low, range.high] : [])) ?? { low: 0, high: 1 };
  const footballSpan = Math.max(1e-8, footballDomain.high - footballDomain.low);

  function loadSample(kind: 'tech' | 'industrials') { setModel(sample(kind)); setUseCompsMedian(true); }
  function printReport() { setTab('summary'); window.setTimeout(() => window.print(), 120); }
  function addPeer() {
    setModel((current) => ({ ...current, peers: [...current.peers, { id: `peer-${Date.now()}`, companyName: 'New Peer', ticker: 'NEW', sharePrice: 0, dilutedShares: 0, totalDebt: 0, cash: 0, revenue: 0, ebitda: 0, netIncome: 0, included: true }] }));
  }
  function updatePeer(id: string, key: keyof IntegratedPeer, value: string | boolean) {
    setModel((current) => ({ ...current, peers: current.peers.map((peer) => peer.id !== id ? peer : { ...peer, [key]: key === 'companyName' || key === 'ticker' || typeof value === 'boolean' ? value : Number(value) }) }));
  }

  return <section className="integrated-engine" aria-labelledby="integrated-engine-title">
    <div className="engine-heading"><div><p className="analysis-eyebrow">INTEGRATED VALUATION MOTOR · ILLUSTRATIVE SANDBOX</p><h3 id="integrated-engine-title">DCF + Comparable Companies</h3><p className="note">Live analyst sandbox. Example data is illustrative and is never saved as company evidence or used by the strict source-backed DCF.</p><div className="engine-target-identity"><label>Target company<input value={model.companyName} onChange={(event) => setModel((current) => ({ ...current, companyName: event.target.value }))} /></label><label>Ticker<input value={model.ticker} onChange={(event) => setModel((current) => ({ ...current, ticker: event.target.value.toUpperCase() }))} /></label><label>Currency<input maxLength={3} value={model.currency} onChange={(event) => setModel((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} /></label></div></div>
      <div className="engine-templates"><button type="button" className="secondary-button" onClick={() => loadSample('tech')}>Load sample tech company</button><button type="button" className="secondary-button" onClick={() => loadSample('industrials')}>Load sample industrials</button><button type="button" className="secondary-button" onClick={printReport}>Print / Save PDF</button></div></div>
    <div className="engine-tabs" role="tablist" aria-label="Integrated valuation views">
      {([['summary', 'Summary'], ['comps', 'Comps'], ['dcf', 'DCF Model'], ['sensitivity', 'Sensitivity']] as const).map(([id, label]) => <button id={`integrated-tab-${id}`} type="button" role="tab" aria-controls="integrated-tab-panel" aria-selected={tab === id} className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    {tab === 'summary' && <div className="engine-view" id="integrated-tab-panel" role="tabpanel" aria-labelledby="integrated-tab-summary" aria-live="polite">
      <div className="engine-kpis"><article><small>Indicative range / share</small><strong>{amount(model.currency, valuationLow)} – {amount(model.currency, valuationHigh)}</strong></article><article><small>DCF WACC</small><strong>{pct(dcf.wacc)}</strong></article><article><small>Included peers</small><strong>{comps.includedCount}</strong></article><article><small>Comps median EV / EBITDA</small><strong>{comps.evEbitda.median == null ? 'N/A' : `${comps.evEbitda.median.toFixed(1)}x`}</strong></article></div>
      <div className="engine-summary-grid"><section className="engine-card"><h4>Football field · per-share ranges</h4><p className="note">DCF spans use the adjacent sensitivity bands; Comps spans use included peer low-to-high multiples. The current price is shown as a point.</p>{footballRanges.map(({ label, range }) => <FootballRange key={label} label={label} range={range} domain={footballDomain} span={footballSpan} currency={model.currency} />)}</section>
        <section className="engine-card"><h4>Projected UFCF</h4><div className="ufcf-chart" role="img" aria-label="Five-year projected unlevered free cash flow"><div className="ufcf-bars">{dcf.projections.map((year) => { const max = Math.max(1, ...dcf.projections.map((row) => Math.abs(row.ufcf))); return <div className="ufcf-bar-column" key={year.year}><span>{amount(model.currency, year.ufcf, 0)}</span><i style={{ height: `${Math.max(3, Math.abs(year.ufcf) / max * 100)}%` }} /><small>Y{year.year}</small></div>; })}</div></div></section></div>
      <div className="engine-print-only"><h4>Comparable-company inputs and calculations</h4><div className="table-scroll"><table><thead><tr><th>Company</th><th>Ticker</th><th>Included</th><th>Equity value</th><th>EV</th><th>EV/Revenue</th><th>EV/EBITDA</th><th>P/E</th></tr></thead><tbody>{comps.rows.map((peer) => <tr key={peer.id}><td>{peer.companyName}</td><td>{peer.ticker}</td><td>{peer.included ? 'Yes' : 'No'}</td><td>{amount(model.currency, peer.equityValue, 0)}</td><td>{amount(model.currency, peer.enterpriseValue, 0)}</td><td>{peer.evRevenue?.toFixed(2) ?? 'N/A'}</td><td>{peer.evEbitda?.toFixed(2) ?? 'N/A'}</td><td>{peer.pe?.toFixed(2) ?? 'N/A'}</td></tr>)}</tbody></table></div>
        <h4>Five-year DCF projection</h4><div className="table-scroll"><table><thead><tr><th>Metric</th>{dcf.projections.map((row) => <th key={row.year}>Year {row.year}</th>)}</tr></thead><tbody>{([['Revenue', 'revenue'], ['EBITDA', 'ebitda'], ['EBIT', 'ebit'], ['Taxes', 'taxes'], ['EBIAT', 'ebiat'], ['D&A', 'da'], ['CapEx', 'capex'], ['Change in NWC', 'changeNwc'], ['UFCF', 'ufcf'], ['PV of UFCF', 'presentValue']] as const).map(([label, key]) => <tr key={key}><th>{label}</th>{dcf.projections.map((row) => <td key={row.year}>{amount(model.currency, row[key], 0)}</td>)}</tr>)}</tbody></table></div>
        <h4>DCF outputs and linked assumptions</h4><p>WACC {pct(dcf.wacc)} · Perpetuity growth {pct(model.dcf.perpetuityGrowthRate)} · Exit EV/EBITDA {linkedExitMultiple?.toFixed(2) ?? model.dcf.exitMultiple.toFixed(2)}x · Perpetuity value/share {amount(model.currency, dcf.perpetuityPerShare)} · Exit value/share {amount(model.currency, dcf.exitPerShare)}</p>
        <p>Scenario values are illustrative sandbox calculations, not source-complete company valuations. Use retained evidence before relying on or sharing any company-specific conclusion.</p></div>
      <p className="caveat">Indicative outputs are only as reliable as the explicitly entered inputs. The company-specific DCF report remains locked until retained primary-source actuals and scenario-driver evidence are complete.</p>
    </div>}
    {tab === 'comps' && <div className="engine-view" id="integrated-tab-panel" role="tabpanel" aria-labelledby="integrated-tab-comps"><p className="note">Edit peer inputs directly; values and summary statistics recalculate immediately. Negative or zero EBITDA/net income produces N/A and is excluded from that multiple’s statistics.</p>
      <div className="table-scroll"><table className="integrated-peer-table"><thead><tr><th>Include</th><th>Company</th><th>Ticker</th><th>Price</th><th>Diluted shares</th><th>Debt</th><th>Cash</th><th>Revenue (LTM)</th><th>EBITDA (LTM)</th><th>Net income (LTM)</th><th>Equity value</th><th>EV</th><th>EV/Rev</th><th>EV/EBITDA</th><th>P/E</th><th>Remove</th></tr></thead><tbody>{comps.rows.map((peer) => <tr key={peer.id}>
        <td><input aria-label={`Include ${peer.companyName}`} type="checkbox" checked={peer.included} onChange={(event) => updatePeer(peer.id, 'included', event.target.checked)} /></td>
        {(['companyName', 'ticker'] as const).map((key) => <td key={key}><input aria-label={`${key} ${peer.ticker}`} value={peer[key]} onChange={(event) => updatePeer(peer.id, key, event.target.value)} /></td>)}
        {(['sharePrice', 'dilutedShares', 'totalDebt', 'cash', 'revenue', 'ebitda', 'netIncome'] as const).map((key) => <td key={key}><input aria-label={`${key} ${peer.ticker}`} type="number" inputMode="decimal" value={peer[key]} onChange={(event) => updatePeer(peer.id, key, event.target.value)} /></td>)}
        <td>{amount(model.currency, peer.equityValue, 0)}</td><td>{amount(model.currency, peer.enterpriseValue, 0)}</td><td>{peer.evRevenue?.toFixed(1) ?? 'N/A'}</td><td>{peer.evEbitda?.toFixed(1) ?? 'N/A'}</td><td>{peer.pe?.toFixed(1) ?? 'N/A'}</td>
        <td><button type="button" aria-label={`Delete ${peer.companyName}`} onClick={() => setModel((current) => ({ ...current, peers: current.peers.filter((row) => row.id !== peer.id) }))}>Delete</button></td>
      </tr>)}</tbody><tfoot><tr><th colSpan={12}>Mean / Median / Low / High · Included peers only</th><td>{comps.evRevenue.mean?.toFixed(1) ?? 'N/A'} / {comps.evRevenue.median?.toFixed(1) ?? 'N/A'} / {comps.evRevenue.low?.toFixed(1) ?? 'N/A'} / {comps.evRevenue.high?.toFixed(1) ?? 'N/A'}</td><td>{comps.evEbitda.mean?.toFixed(1) ?? 'N/A'} / {comps.evEbitda.median?.toFixed(1) ?? 'N/A'} / {comps.evEbitda.low?.toFixed(1) ?? 'N/A'} / {comps.evEbitda.high?.toFixed(1) ?? 'N/A'}</td><td>{comps.pe.mean?.toFixed(1) ?? 'N/A'} / {comps.pe.median?.toFixed(1) ?? 'N/A'} / {comps.pe.low?.toFixed(1) ?? 'N/A'} / {comps.pe.high?.toFixed(1) ?? 'N/A'}</td><td /></tr></tfoot></table></div>
      <button type="button" className="secondary-button" onClick={addPeer}>Add peer</button>
    </div>}
    {tab === 'dcf' && <div className="engine-view" id="integrated-tab-panel" role="tabpanel" aria-labelledby="integrated-tab-dcf"><p className={dcf.wacc <= 0 || dcf.wacc <= model.dcf.perpetuityGrowthRate || (useCompsMedian && comps.evEbitda.median == null) ? 'caveat' : 'note'}>{dcf.wacc <= 0 ? 'WACC must be positive for DCF discounting; valuation outputs display N/A until corrected.' : dcf.wacc <= model.dcf.perpetuityGrowthRate ? 'WACC must exceed the perpetuity growth rate; the perpetuity method currently displays N/A.' : useCompsMedian && comps.evEbitda.median == null ? 'No valid included-peer EV/EBITDA median is available. Exit-multiple valuation is stopped; switch to a manually entered sandbox multiple or restore valid peer records.' : 'Comps median EV/EBITDA is linked live to the exit multiple below. This is a cross-check only; it does not determine WACC or perpetuity growth.'}</p>
      <div className="engine-card"><h4>WACC inputs</h4><div className="engine-field-grid">{([['riskFreeRate', 'Risk-free rate'], ['marketRiskPremium', 'Market risk premium'], ['beta', 'Levered beta'], ['costOfDebt', 'Pre-tax cost of debt'], ['taxRate', 'Tax rate'], ['debtToCapital', 'Debt / total capital']] as const).map(([key, label]) => <Field key={key} label={label} value={displayInput(key, model.dcf[key])} onChange={(value) => updateDcf(key, value * inputScale(key))} suffix={key === 'beta' ? 'x' : '%'} />)}</div><p className="engine-formula">Cost of equity {pct(dcf.costOfEquity)} · After-tax debt cost {pct(dcf.afterTaxCostOfDebt)} · WACC <strong>{pct(dcf.wacc)}</strong></p></div>
      <div className="engine-card"><h4>Target & terminal assumptions</h4><div className="engine-field-grid">{([['baseRevenue', 'Year 0 revenue'], ['baseEbitdaMargin', 'Year 0 EBITDA margin'], ['daPercent', 'D&A / revenue'], ['capexPercent', 'Year 0 CapEx / revenue'], ['nwcPercent', 'NWC investment / revenue'], ['perpetuityGrowthRate', 'Perpetuity growth'], ['targetDebt', 'Current debt'], ['targetCash', 'Current cash'], ['dilutedShares', 'Target diluted shares'], ['targetNetIncome', 'Target LTM net income'], ['currentPrice', 'Current share price']] as const).map(([key, label]) => key === 'currentPrice' ? <Field key={key} label={label} value={model.currentPrice} onChange={(value) => setModel((current) => ({ ...current, currentPrice: value }))} suffix={model.currency} /> : <Field key={key} label={label} value={displayInput(key, model.dcf[key])} onChange={(value) => updateDcf(key, value * inputScale(key))} suffix={isPercentInput(key) ? '%' : model.currency} />)}
        <div className="engine-field"><Field label="Exit EV/EBITDA multiple" value={displayInput('exitMultiple', useCompsMedian && comps.evEbitda.median != null ? comps.evEbitda.median : model.dcf.exitMultiple)} onChange={(value) => updateDcf('exitMultiple', value)} suffix={useCompsMedian ? 'x · linked' : 'x · manual'} disabled={useCompsMedian} /><button className="secondary-button" type="button" onClick={() => setUseCompsMedian((value) => !value)}>{useCompsMedian ? `Using Comps median${comps.evEbitda.median == null ? ' (N/A)' : ` (${comps.evEbitda.median.toFixed(2)}x)`} · switch to manual` : 'Use Comps median EV/EBITDA'}</button></div></div></div>
      <div className="engine-card"><h4>Year 0 baseline calculations</h4><div className="engine-kpis baseline-kpis">{([['Revenue', dcf.baseYear.revenue], ['EBITDA', dcf.baseYear.ebitda], ['EBIT', dcf.baseYear.ebit], ['Taxes', dcf.baseYear.taxes], ['EBIAT', dcf.baseYear.ebiat], ['D&A', dcf.baseYear.da], ['CapEx', dcf.baseYear.capex], ['Change in NWC', dcf.baseYear.changeNwc], ['UFCF', dcf.baseYear.ufcf]] as const).map(([label, value]) => <article key={label}><small>{label}</small><strong>{amount(model.currency, value, 0)}</strong></article>)}</div></div>
      <div className="table-scroll"><table className="integrated-projection-table"><thead><tr><th>Projection</th>{dcf.projections.map((row) => <th key={row.year}>Year {row.year}</th>)}</tr></thead><tbody>
        {([['Revenue growth', 'revenueGrowth', true], ['Revenue', 'revenue', false], ['EBITDA margin', 'ebitdaMargin', true], ['EBITDA', 'ebitda', false], ['EBIT', 'ebit', false], ['Taxes', 'taxes', false], ['EBIAT', 'ebiat', false], ['D&A', 'da', false], ['CapEx / revenue', 'capexPercentForecast', true], ['CapEx', 'capex', false], ['NWC investment / revenue', 'nwcPercentForecast', true], ['Change in NWC', 'changeNwc', false], ['UFCF', 'ufcf', false], ['Discount factor', 'discountFactor', false], ['PV of UFCF', 'presentValue', false]] as const).map(([label, key, editable]) => <tr key={label}><th>{label}</th>{dcf.projections.map((row, index) => <td key={row.year}>{editable ? <input aria-label={`${label}, year ${row.year}`} type="number" inputMode="decimal" min={key === 'revenueGrowth' ? -99.9 : undefined} step="0.1" value={((model.dcf[key as 'revenueGrowth' | 'ebitdaMargin' | 'capexPercentForecast' | 'nwcPercentForecast'][index] ?? 0) * 100)} onChange={(event) => updateYear(key as 'revenueGrowth' | 'ebitdaMargin' | 'capexPercentForecast' | 'nwcPercentForecast', index, Number(event.target.value) / 100)} /> : key === 'discountFactor' ? (Number.isFinite(row.discountFactor) ? row.discountFactor.toFixed(3) : 'N/A') : amount(model.currency, row[key as keyof typeof row] as number, 0)}</td>)}</tr>)}
      </tbody></table></div>
      <div className="engine-kpis"><article><small>Perpetuity growth EV / share</small><strong>{amount(model.currency, dcf.perpetuityPerShare)}</strong></article><article><small>Exit multiple EV / share</small><strong>{amount(model.currency, dcf.exitPerShare)}</strong></article><article><small>Linked Comps median multiple</small><strong>{comps.evEbitda.median?.toFixed(2) ?? 'N/A'}x</strong></article></div>
    </div>}
    {tab === 'sensitivity' && <div className="engine-view" id="integrated-tab-panel" role="tabpanel" aria-labelledby="integrated-tab-sensitivity"><p className="note">Sensitivity is a local sandbox analysis around the current WACC, growth rate, and linked Comps exit multiple. Invalid Gordon-growth cells (WACC ≤ growth) display N/A.</p><div className="engine-summary-grid">
      <SensitivityTable title="WACC vs. Perpetuity growth · implied share value" headers={[-0.005, -0.0025, 0, 0.0025, 0.005].map((delta) => model.dcf.perpetuityGrowthRate + delta)} rows={[-0.01, -0.005, 0, 0.005, 0.01].map((delta) => dcf.wacc + delta)} getValue={(wacc, growth) => dcf.sensitivities.find((cell) => close(cell.wacc, wacc) && close(cell.growth, growth) && close(cell.exitMultiple, comps.evEbitda.median ?? model.dcf.exitMultiple))?.perpetuityPerShare ?? null} formatHeader={pct} />
      <SensitivityTable title="WACC vs. Exit multiple · implied share value" headers={[-2, -1, 0, 1, 2].map((delta) => Math.max(0, (comps.evEbitda.median ?? model.dcf.exitMultiple) + delta))} rows={[-0.01, -0.005, 0, 0.005, 0.01].map((delta) => dcf.wacc + delta)} getValue={(wacc, multiple) => dcf.sensitivities.find((cell) => close(cell.wacc, wacc) && close(cell.exitMultiple, multiple) && close(cell.growth, model.dcf.perpetuityGrowthRate))?.exitPerShare ?? null} formatHeader={(value) => `${value.toFixed(1)}x`} /></div></div>}
  </section>;
}

function isPercentInput(key: string): boolean { return ['riskFreeRate', 'marketRiskPremium', 'costOfDebt', 'taxRate', 'debtToCapital', 'baseEbitdaMargin', 'daPercent', 'capexPercent', 'nwcPercent', 'perpetuityGrowthRate'].includes(key); }
function inputScale(key: string): number { return isPercentInput(key) ? 0.01 : 1; }
function displayInput(key: string, value: number | number[]): number { return typeof value === 'number' ? value / inputScale(key) : 0; }
function close(left: number, right: number): boolean { return Math.abs(left - right) < 1e-8; }
function FootballRange({ label, range, domain, span, currency }: { label: string; range: { low: number; high: number } | null; domain: { low: number; high: number }; span: number; currency: string }) {
  if (!range) return <div className="football-range"><span>{label}</span><strong>N/A</strong></div>;
  const left = Math.max(0, Math.min(100, (range.low - domain.low) / span * 100));
  const right = Math.max(left + 1.5, Math.min(100, (range.high - domain.low) / span * 100));
  return <div className="football-range"><div><span>{label}</span><strong>{amount(currency, range.low)} – {amount(currency, range.high)}</strong></div><div className="football-track" role="img" aria-label={`${label}: ${amount(currency, range.low)} to ${amount(currency, range.high)}`}><i style={{ left: `${left}%`, width: `${right - left}%` }} /></div></div>;
}
function SensitivityTable({ title, headers, rows, getValue, formatHeader }: { title: string; headers: number[]; rows: number[]; getValue: (wacc: number, header: number) => number | null; formatHeader: (value: number) => string }) {
  return <section className="engine-card sensitivity-card"><h4>{title}</h4><div className="table-scroll"><table><thead><tr><th>WACC ↓ / Driver →</th>{headers.map((value) => <th key={value}>{formatHeader(value)}</th>)}</tr></thead><tbody>{rows.map((wacc) => <tr key={wacc}><th>{pct(wacc)}</th>{headers.map((header) => <td key={header}>{getValue(wacc, header) == null ? 'N/A' : getValue(wacc, header)!.toFixed(2)}</td>)}</tr>)}</tbody></table></div></section>;
}
