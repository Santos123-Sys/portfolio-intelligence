'use client';

/**
 * The ONE cross-currency number this dashboard is allowed to show (ADR-002).
 * Fetched lazily from /api/portfolios?displayCurrency=..., which only ever
 * returns a cosmetic total plus its disclaimer — never a figure that feeds
 * back into a risk or performance metric.
 */

import { useState } from 'react';
import type { DisplayTotalResult } from '@/lib/fx';

export function DisplayTotalToggle({ defaultCurrency }: { defaultCurrency: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DisplayTotalResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next && !data && !loading) {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/portfolios?displayCurrency=${defaultCurrency}`);
        const json = await res.json();
        if (json.displayTotal) {
          setData(json.displayTotal);
        } else {
          setError(json.displayTotalError ?? 'Display total unavailable right now.');
        }
      } catch {
        setError('Could not reach the FX service.');
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="display-total">
      <button type="button" className="display-total-trigger" onClick={handleToggle}>
        {open ? 'Hide' : 'Show'} display total
      </button>

      {open && (
        <div className="display-total-panel">
          {loading && <p className="note">Fetching ECB reference rates…</p>}
          {error && <p className="caveat">{error}</p>}
          {data && (
            <>
              <div className="big">
                {data.convertedTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                <span className="cur">{data.displayCurrency}</span>
              </div>
              <p className="note">{data.disclaimer}</p>
              <table>
                <thead>
                  <tr>
                    <th>Portfolio</th>
                    <th className="num">Native</th>
                    <th className="num">Converted</th>
                  </tr>
                </thead>
                <tbody>
                  {data.components.map((c) => (
                    <tr key={c.portfolioId}>
                      <td>{c.name}</td>
                      <td className="num">
                        {c.valueNative.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        <span className="cur">{c.nativeCurrency}</span>
                      </td>
                      <td className="num">
                        {c.convertedValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        <span className="cur">{data.displayCurrency}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
