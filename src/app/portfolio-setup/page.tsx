'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';

interface PortfolioRow {
  id: string;
  name: string;
  portfolioType: 'swiss_quality' | 'brazilian_growth' | 'fixed_income';
  baseCurrency: string;
  investmentObjective: string | null;
}

interface PositionRow {
  id: string;
  portfolioId: string;
  portfolioName: string;
  ticker: string;
  companyName: string;
  exchange: string;
  currency: string;
  quantity: string | number;
  avgCost: string | number;
}

const ROLE_LABELS: Record<PortfolioRow['portfolioType'], string> = {
  swiss_quality: 'Swiss quality',
  brazilian_growth: 'Brazilian growth',
  fixed_income: 'Fixed income',
};

async function responseError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: string | { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
  } | null;
  if (typeof body?.error === 'string') return body.error;
  if (body?.error && typeof body.error === 'object') {
    const messages = [
      ...(body.error.formErrors ?? []),
      ...Object.values(body.error.fieldErrors ?? {}).flat(),
    ];
    if (messages.length) return messages.join(' ');
  }
  return `Request failed (${response.status})`;
}

export default function PortfolioSetupPage() {
  const [portfolios, setPortfolios] = useState<PortfolioRow[]>([]);
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [portfolioBusy, setPortfolioBusy] = useState(false);
  const [positionBusy, setPositionBusy] = useState(false);
  const [portfolioMessage, setPortfolioMessage] = useState<string | null>(null);
  const [positionMessage, setPositionMessage] = useState<string | null>(null);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState('');

  const loadData = useCallback(async () => {
    setLoadError(null);
    try {
      const [portfolioResponse, positionResponse] = await Promise.all([
        fetch('/api/portfolios'),
        fetch('/api/positions'),
      ]);
      if (!portfolioResponse.ok) throw new Error(await responseError(portfolioResponse));
      if (!positionResponse.ok) throw new Error(await responseError(positionResponse));
      const [portfolioData, positionData] = await Promise.all([
        portfolioResponse.json() as Promise<{ portfolios: PortfolioRow[] }>,
        positionResponse.json() as Promise<{ positions: PositionRow[] }>,
      ]);
      setPortfolios(portfolioData.portfolios);
      setPositions(positionData.positions);
      setSelectedPortfolioId((current) => {
        if (portfolioData.portfolios.some((portfolio) => portfolio.id === current)) return current;
        return portfolioData.portfolios[0]?.id ?? '';
      });
    } catch (error) {
      setLoadError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function createPortfolio(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setPortfolioBusy(true);
    setPortfolioMessage(null);
    const form = new FormData(formElement);
    const response = await fetch('/api/portfolios', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: form.get('name'),
        portfolioType: form.get('portfolioType'),
        baseCurrency: form.get('baseCurrency'),
        investmentObjective: form.get('investmentObjective'),
      }),
    }).catch(() => null);
    if (!response?.ok) {
      setPortfolioMessage(response ? await responseError(response) : 'Unable to reach the dashboard API');
      setPortfolioBusy(false);
      return;
    }
    const data = (await response.json()) as { portfolio: PortfolioRow };
    formElement.reset();
    setPortfolioMessage(`${data.portfolio.name} was created.`);
    await loadData();
    setSelectedPortfolioId(data.portfolio.id);
    setPortfolioBusy(false);
  }

  async function createPosition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPositionBusy(true);
    setPositionMessage(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const sector = String(form.get('sector') ?? '').trim();
    const country = String(form.get('country') ?? '').trim();
    const response = await fetch('/api/positions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        portfolioId: form.get('portfolioId'),
        ticker: form.get('ticker'),
        companyName: form.get('companyName'),
        exchange: form.get('exchange'),
        currency: form.get('currency'),
        ...(sector ? { sector } : {}),
        ...(country ? { country } : {}),
        quantity: form.get('quantity'),
        avgCost: form.get('avgCost'),
      }),
    }).catch(() => null);
    if (!response?.ok) {
      setPositionMessage(response ? await responseError(response) : 'Unable to reach the dashboard API');
      setPositionBusy(false);
      return;
    }
    const data = (await response.json()) as { security: { ticker: string } };
    const portfolioId = String(form.get('portfolioId'));
    formElement.reset();
    setPositionMessage(`${data.security.ticker} was added.`);
    await loadData();
    setSelectedPortfolioId(portfolioId);
    setPositionBusy(false);
  }

  return (
    <main>
      <h1>Portfolio Setup</h1>
      <p className="sub">Name the destination portfolios for your thesis and, only after an investment decision, record the positions you actually own.</p>

      {loadError && <p className="security-message error" role="alert">{loadError}</p>}

      <section className="card setup-readiness" aria-live="polite">
        <h2>Discovery setup</h2>
        {loading ? (
          <p className="note">Checking setup…</p>
        ) : portfolios.length > 0 ? (
          <>
            <p className="security-state">A destination portfolio is ready. Positions are not required for market research.</p>
            <p className="note">Next: run discovery, review the candidates, and record a position only after you make an investment decision.</p>
            <Link className="action-button inline-action" href="/ai-stock-discovery">Go to stock discovery</Link>
          </>
        ) : (
          <>
            <p className="caveat">Start with the investment thesis. Create a portfolio here only when the thesis does not provide a destination name.</p>
            <ul className="note">
              <li>Confirm the investment thesis and its market mandate.</li>
              <li>If needed, create a named portfolio destination.</li>
              <li>Run market research. Do not add a position at this stage.</li>
            </ul>
            <Link className="action-button inline-action" href="/investment-thesis">Open investment thesis</Link>
          </>
        )}
      </section>

      <div className="setup-grid">
        <section className="card">
          <h2>Create portfolio</h2>
          <form className="setup-form" onSubmit={createPortfolio}>
            <label>
              Portfolio name
              <input name="name" maxLength={100} required placeholder="Swiss Quality & Stability" />
            </label>
            <label>
              Thesis role
              <select name="portfolioType" defaultValue="swiss_quality" required>
                {Object.entries(ROLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              Base currency
              <input name="baseCurrency" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={3} pattern="[A-Za-z]{3}" required placeholder="CHF" />
            </label>
            <label>
              Investment objective
              <textarea name="investmentObjective" maxLength={1000} required rows={4} />
            </label>
            {portfolioMessage && <p className={portfolioMessage.endsWith('created.') ? 'security-state' : 'login-error'} role="status">{portfolioMessage}</p>}
            <button type="submit" disabled={portfolioBusy}>{portfolioBusy ? 'Creating…' : 'Create portfolio'}</button>
          </form>
        </section>

        <section className="card">
          <h2>Add position</h2>
          <p className="note">Use this only after a candidate has been reviewed and you have decided to invest, or when recording an existing holding.</p>
          <form className="setup-form" onSubmit={createPosition}>
            <label>
              Portfolio
              <select
                name="portfolioId"
                value={selectedPortfolioId}
                onChange={(event) => setSelectedPortfolioId(event.target.value)}
                required
                disabled={portfolios.length === 0}
              >
                {portfolios.length === 0 ? <option value="">Create a portfolio first</option> : portfolios.map((portfolio) => (
                  <option key={portfolio.id} value={portfolio.id}>{portfolio.name}</option>
                ))}
              </select>
            </label>
            <div className="setup-form-row">
              <label>Ticker<input name="ticker" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={20} required placeholder="NESN" /></label>
              <label>Exchange MIC<input name="exchange" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={4} pattern="[A-Za-z]{4}" required placeholder="XSWX" /></label>
            </div>
            <label>Company name<input name="companyName" maxLength={160} required placeholder="Nestlé S.A." /></label>
            <div className="setup-form-row">
              <label>Currency<input name="currency" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={3} pattern="[A-Za-z]{3}" required placeholder="CHF" /></label>
              <label>Country<input name="country" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={2} pattern="[A-Za-z]{2}" placeholder="CH" /></label>
            </div>
            <label>Sector<input name="sector" maxLength={100} placeholder="Consumer Staples" /></label>
            <div className="setup-form-row">
              <label>Quantity<input name="quantity" type="number" inputMode="decimal" min="0.00000001" step="any" required /></label>
              <label>Average cost<input name="avgCost" type="number" inputMode="decimal" min="0" step="any" required /></label>
            </div>
            <p className="note">Weights, market values and risk metrics remain dashboard-computed fields and are not entered here.</p>
            {positionMessage && <p className={positionMessage.endsWith('added.') ? 'security-state' : 'login-error'} role="status">{positionMessage}</p>}
            <button type="submit" disabled={positionBusy || portfolios.length === 0}>{positionBusy ? 'Adding…' : 'Add position'}</button>
          </form>
        </section>
      </div>

      <section className="card">
        <h2>Configured holdings</h2>
        {positions.length === 0 ? <p className="note">No positions configured.</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Ticker</th><th>Company</th><th>Portfolio</th><th>Exchange</th><th>Currency</th><th className="num">Quantity</th><th className="num">Average cost</th></tr></thead>
              <tbody>{positions.map((position) => (
                <tr key={position.id}>
                  <td><strong>{position.ticker}</strong></td>
                  <td>{position.companyName}</td>
                  <td>{position.portfolioName}</td>
                  <td>{position.exchange}</td>
                  <td>{position.currency}</td>
                  <td className="num">{Number(position.quantity).toLocaleString()}</td>
                  <td className="num">{Number(position.avgCost).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
