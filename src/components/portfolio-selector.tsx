'use client';

/** PortfolioSelector — tabs/toggle to pick which single portfolio a page shows.
 * Used by Allocation, Risk Detail (and available to any page that must stay
 * single-portfolio per ADR-002; there is deliberately no "all portfolios" tab). */
export interface SelectablePortfolio {
  id: string;
  name: string;
  baseCurrency: string;
}

export function PortfolioSelector({
  portfolios,
  selectedId,
  onSelect,
}: {
  portfolios: SelectablePortfolio[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (portfolios.length === 0) return null;
  return (
    <div className="portfolio-selector" role="tablist" aria-label="Portfolio">
      {portfolios.map((p) => (
        <button
          key={p.id}
          type="button"
          role="tab"
          aria-selected={p.id === selectedId}
          className={`portfolio-tab${p.id === selectedId ? ' active' : ''}`}
          onClick={() => onSelect(p.id)}
        >
          {p.name} <span className="cur">{p.baseCurrency}</span>
        </button>
      ))}
    </div>
  );
}
