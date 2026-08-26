import Link from 'next/link';
import type { ReactNode } from 'react';

const navigation = [
  ['/', 'Overview'],
  ['/investment-thesis', 'Investment Thesis'],
  ['/ai-stock-discovery', 'AI Stock Discovery'],
  ['/agentic-system', 'Agentic System'],
  ['/candidates', 'Candidates'],
  ['/portfolio', 'Portfolio'],
  ['/risk-kpis', 'Risk & KPIs'],
  ['/securities', 'Securities'],
  ['/ai-insights', 'AI Insights'],
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>Portfolio Intelligence</strong>
          <span>Thesis-driven investment management</span>
        </div>
        <nav aria-label="Main navigation">
          {navigation.map(([href, label]) => (
            <Link key={href} href={href} className="nav-link">
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <section className="content">{children}</section>
    </div>
  );
}
