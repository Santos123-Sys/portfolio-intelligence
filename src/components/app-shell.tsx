'use client';

import type { ReactNode } from 'react';
import { PortfolioProvider } from '@/lib/portfolio-context';
import { Header } from './header';
import { ErrorBoundary } from './error-boundary';
import { usePathname } from 'next/navigation';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/login') return <>{children}</>;
  return (
    <PortfolioProvider>
      <div className="app-shell">
        <Header />
        <section className="content">
          <ErrorBoundary>{children}</ErrorBoundary>
        </section>
      </div>
    </PortfolioProvider>
  );
}
