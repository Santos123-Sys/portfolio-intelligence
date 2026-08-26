'use client';

/**
 * Header — Section 5.4: Logo | Title | Portfolio Breadcrumb | Nav Links |
 * Theme Toggle. The primary Nav is the spec's seven-page information
 * architecture (Section 5.3); pages built before this spec pass are kept
 * reachable under "More" rather than deleted, since they cover ground (thesis
 * upload, candidate review, provenance) the new pages don't replace.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { usePortfolioBreadcrumb } from '@/lib/portfolio-context';

const PRIMARY_NAV = [
  ['/', 'Overview'],
  ['/allocation', 'Allocation'],
  ['/positions', 'Positions'],
  ['/risk', 'Risk Detail'],
  ['/intelligence', 'AI Feed'],
  ['/decisions', 'Decision Log'],
] as const;

const EXTENDED_NAV = [
  ['/investment-thesis', 'Investment Thesis'],
  ['/ai-stock-discovery', 'AI Stock Discovery'],
  ['/agentic-system', 'Agentic System'],
  ['/candidates', 'Candidates'],
  ['/securities', 'Securities'],
] as const;

function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('theme');
      if (stored === 'light' || stored === 'dark') {
        setTheme(stored);
        document.documentElement.dataset.theme = stored;
      }
    } catch {
      // localStorage unavailable — stay on the dark default.
    }
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem('theme', next);
    } catch {
      // Best-effort only; theme just won't persist across reloads.
    }
  }

  return (
    <button type="button" className="theme-toggle" onClick={toggle} aria-label="Toggle theme">
      {theme === 'dark' ? 'Dark' : 'Light'}
    </button>
  );
}

export function Header() {
  const pathname = usePathname();
  const { viewing } = usePortfolioBreadcrumb();
  const [extendedOpen, setExtendedOpen] = useState(false);

  return (
    <header className="app-header">
      <div className="app-header-row">
        <Link href="/" className="brand">
          <strong>Portfolio Intelligence</strong>
          <span>Thesis-driven investment management</span>
        </Link>

        <nav aria-label="Main navigation" className="primary-nav">
          {PRIMARY_NAV.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className={`nav-link${pathname === href ? ' active' : ''}`}
            >
              {label}
            </Link>
          ))}
          <div className="nav-more">
            <button
              type="button"
              className="nav-link"
              onClick={() => setExtendedOpen((o) => !o)}
              aria-expanded={extendedOpen}
            >
              More
            </button>
            {extendedOpen && (
              <div className="nav-more-panel">
                {EXTENDED_NAV.map(([href, label]) => (
                  <Link key={href} href={href} className="nav-link" onClick={() => setExtendedOpen(false)}>
                    {label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </nav>

        <ThemeToggle />
      </div>

      {pathname !== '/' && (
        <div className="breadcrumb">
          {viewing ? (
            <>
              Viewing: <strong>{viewing.name}</strong> <span className="cur">({viewing.currency})</span>
            </>
          ) : (
            <span className="note">No portfolio selected</span>
          )}
        </div>
      )}
    </header>
  );
}
