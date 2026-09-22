'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const PORTFOLIO_WORKSPACE_ROUTES = [
  ['/positions', 'Positions'],
  ['/allocation', 'Allocation'],
  ['/risk', 'Risk'],
  ['/governance', 'Investment control'],
] as const;

export function PortfolioWorkspaceNav() {
  const pathname = usePathname();

  return (
    <nav className="workspace-nav" aria-label="Portfolio workspace">
      <span className="workspace-nav-label">Portfolio workspace</span>
      <div className="workspace-nav-links">
        {PORTFOLIO_WORKSPACE_ROUTES.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            className={`workspace-nav-link${pathname === href ? ' active' : ''}`}
            aria-current={pathname === href ? 'page' : undefined}
          >
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
