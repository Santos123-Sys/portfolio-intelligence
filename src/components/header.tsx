'use client';

/**
 * The primary navigation follows the user's investment workflow. Supporting
 * operational pages remain available under More without competing with the
 * next action a user must take to move from thesis to an invested portfolio.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { usePortfolioBreadcrumb } from '@/lib/portfolio-context';

const WORKFLOW_NAV = [
  ['/', 'Overview'],
  ['/investment-thesis', '1. Thesis'],
  ['/ai-stock-discovery', '2. Discover'],
  ['/positions', '3. Portfolio'],
  ['/risk', 'Monitor'],
] as const;

const EXTENDED_NAV = [
  ['/portfolio-setup', 'Portfolio setup & manual holdings'],
  ['/allocation', 'Allocation'],
  ['/intelligence', 'AI Feed'],
  ['/decisions', 'Decision Log'],
  ['/candidates', 'Candidate records'],
  ['/agentic-system', 'Existing-holdings analysis'],
  ['/agent-settings', 'Agent settings'],
  ['/securities', 'Securities'],
  ['/account/security', 'Account Security'],
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

function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const router = useRouter();
  async function logout() {
    setBusy(true);
    setFailed(false);
    const response = await fetch('/api/auth/session', { method: 'DELETE' }).catch(() => null);
    if (!response?.ok) {
      setFailed(true);
      setBusy(false);
      return;
    }
    router.replace('/login');
    router.refresh();
  }
  return (
    <button type="button" className="theme-toggle" onClick={logout} disabled={busy}>
      {busy ? 'Signing out…' : failed ? 'Retry sign out' : 'Sign out'}
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
          {WORKFLOW_NAV.map(([href, label]) => (
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

        <div className="header-actions">
          <ThemeToggle />
          <LogoutButton />
        </div>
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
