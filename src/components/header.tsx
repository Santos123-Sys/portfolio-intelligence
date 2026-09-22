'use client';

/**
 * The primary navigation follows the user's investment workflow. Supporting
 * operational pages remain available under More without competing with the
 * next action a user must take to move from thesis to an invested portfolio.
 */
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { usePortfolioBreadcrumb } from '@/lib/portfolio-context';
import { useLanguage, type TranslationKey } from '@/lib/i18n';

const WORKFLOW_NAV = [
  ['/how-it-works', 'nav.howItWorks'],
  ['/investment-thesis', 'nav.thesis'],
  ['/ai-stock-discovery', 'nav.discover'],
  ['/positions', 'nav.portfolio'],
] as const satisfies ReadonlyArray<readonly [string, TranslationKey]>;

const EXTENDED_NAV = [
  ['/research-history', 'nav.researchHistory'],
  ['/intelligence', 'nav.aiFeed'],
  ['/decisions', 'nav.decisionLog'],
  ['/candidates', 'nav.candidateRecords'],
  ['/agentic-system', 'nav.holdingsAnalysis'],
  ['/agent-settings', 'nav.agentSettings'],
  ['/securities', 'nav.securities'],
  ['/account/security', 'nav.accountSecurity'],
] as const satisfies ReadonlyArray<readonly [string, TranslationKey]>;

const PORTFOLIO_WORKSPACE_PATHS = new Set(['/positions', '/allocation', '/risk', '/governance']);

function ThemeToggle() {
  const { t } = useLanguage();
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
    <button type="button" className="theme-toggle" onClick={toggle} aria-label={t('actions.toggleTheme')}>
      {theme === 'dark' ? t('actions.dark') : t('actions.light')}
    </button>
  );
}

function LogoutButton() {
  const { t } = useLanguage();
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
      {busy ? t('actions.signingOut') : failed ? t('actions.retrySignOut') : t('actions.signOut')}
    </button>
  );
}

type AccessibleAccount = { accountId: string; accountName: string; accountType: string; role: string };

/** Account context is chosen server-side and persisted in an httpOnly cookie. */
function AccountSwitcher() {
  const { t } = useLanguage();
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccessibleAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/accounts').then((response) => response.ok ? response.json() : null)
      .then((data: { accounts?: AccessibleAccount[]; activeAccountId?: string } | null) => {
        if (cancelled || !data) return;
        setAccounts(data.accounts ?? []);
        setActiveAccountId(data.activeAccountId ?? '');
      }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  if (accounts.length < 2) return null;
  return (
    <label className="account-switcher">
      <span className="sr-only">{t('account.activeClient')}</span>
      <select
        value={activeAccountId}
        disabled={busy}
        onChange={async (event) => {
          const accountId = event.target.value;
          setBusy(true);
          const response = await fetch('/api/accounts', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accountId }),
          }).catch(() => null);
          if (response?.ok) {
            setActiveAccountId(accountId);
            router.refresh();
            window.location.reload();
          }
          setBusy(false);
        }}
      >
        {accounts.map((account) => <option key={account.accountId} value={account.accountId}>
          {account.accountName}
        </option>)}
      </select>
    </label>
  );
}

export function Header() {
  const pathname = usePathname();
  const { viewing } = usePortfolioBreadcrumb();
  const { language, setLanguage, t } = useLanguage();
  const [extendedOpen, setExtendedOpen] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/session').then((response) => response.ok ? response.json() : null)
      .then((data) => { if (!cancelled) setIsPlatformAdmin(Boolean(data?.account?.isPlatformAdmin)); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const extendedNav = EXTENDED_NAV.filter(([href]) =>
    isPlatformAdmin || !['/research-history', '/decisions', '/agent-settings'].includes(href)
  );

  return (
    <header className="app-header">
      <div className="app-header-row">
        <Link href="/" className="brand">
          <Image
            src="/brand/portfolio-intelligence-logo.png"
            alt=""
            width={44}
            height={44}
            className="brand-logo"
            priority
          />
          <span className="brand-copy">
            <strong>Portfolio Intelligence</strong>
            <span>Thesis-driven investment management</span>
          </span>
        </Link>

        <nav aria-label="Main navigation" className="primary-nav">
          {WORKFLOW_NAV.map(([href, labelKey]) => (
            <Link
              key={href}
              href={href}
              className={`nav-link${pathname === href || (href === '/positions' && PORTFOLIO_WORKSPACE_PATHS.has(pathname)) ? ' active' : ''}`}
            >
              {t(labelKey)}
            </Link>
          ))}
          <div className="nav-more">
            <button
              type="button"
              className="nav-link"
              onClick={() => setExtendedOpen((o) => !o)}
              aria-expanded={extendedOpen}
            >
              {t('nav.more')}
            </button>
            {extendedOpen && (
              <div className="nav-more-panel">
                {extendedNav.map(([href, labelKey]) => (
                  <Link key={href} href={href} className="nav-link" onClick={() => setExtendedOpen(false)}>
                    {t(labelKey)}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </nav>

        <div className="header-actions">
          <label className="language-switcher">
            <span className="sr-only">{t('language.label')}</span>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as typeof language)}
              aria-label={t('language.label')}
            >
              <option value="en">EN</option>
              <option value="pt">PT</option>
              <option value="es">ES</option>
              <option value="de">DE</option>
            </select>
          </label>
          <AccountSwitcher />
          <ThemeToggle />
          <LogoutButton />
        </div>
      </div>

      {pathname !== '/' && (
        <div className="breadcrumb">
          {viewing ? (
            <>
              {t('portfolio.viewing')}: <strong>{viewing.name}</strong> <span className="cur">({viewing.currency})</span>
            </>
          ) : (
            <span className="note">{t('portfolio.noneSelected')}</span>
          )}
        </div>
      )}
    </header>
  );
}
