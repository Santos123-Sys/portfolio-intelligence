'use client';

/**
 * Breadcrumb context (Section 3.2: "Breadcrumb clarity" — every page except
 * Overview starts with "Viewing: <portfolio> (<currency>)" so which native
 * currency is on screen is never ambiguous).
 *
 * Deliberately just a name + currency label, not a fetched portfolio object:
 * the Header renders the breadcrumb from whatever the current page last set,
 * and each page is the one that knows which portfolio it's showing.
 */
import { createContext, useContext, useState, type ReactNode } from 'react';

export interface ViewingPortfolio {
  id: string;
  name: string;
  currency: string;
}

interface PortfolioContextValue {
  viewing: ViewingPortfolio | null;
  setViewing: (p: ViewingPortfolio | null) => void;
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const [viewing, setViewing] = useState<ViewingPortfolio | null>(null);
  return (
    <PortfolioContext.Provider value={{ viewing, setViewing }}>
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolioBreadcrumb() {
  const ctx = useContext(PortfolioContext);
  if (!ctx) throw new Error('usePortfolioBreadcrumb must be used within PortfolioProvider');
  return ctx;
}
