'use client';

import type { ReactNode } from 'react';
import { PortfolioProvider } from '@/lib/portfolio-context';
import { Header } from './header';
import { ErrorBoundary } from './error-boundary';

export function AppShell({ children }: { children: ReactNode }) {
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
