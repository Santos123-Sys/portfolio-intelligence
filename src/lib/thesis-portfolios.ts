import type { ThesisCriteria } from '@portfolio-intelligence/agentic-contract';
import { isUnspecifiedThesisMandateCurrency, normalizeThesisMandateCurrency } from './thesis-currency';

const AUTOMATIC_PORTFOLIOS = {
  swiss_quality: { name: 'Swiss Quality', baseCurrency: 'CHF' },
  brazilian_growth: { name: 'Brazilian Growth', baseCurrency: 'BRL' },
} as const;

export type AutomaticPortfolioRole = keyof typeof AUTOMATIC_PORTFOLIOS;

export class ThesisPortfolioConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThesisPortfolioConfigurationError';
  }
}

function titleCaseRole(role: string): string {
  return role.split('_').filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(' ');
}

/**
 * The thesis owns the investment mandate. These containers are therefore
 * created from a confirmed mandate, rather than asking the user to duplicate
 * its role and native currency in a separate setup form.
 */
export function portfoliosRequiredByThesis(criteria: ThesisCriteria) {
  return criteria.portfolios.flatMap((mandate) => {
    if (mandate.role === 'not_suitable') return [];
    if (mandate.role in AUTOMATIC_PORTFOLIOS) {
      const role = mandate.role as AutomaticPortfolioRole;
      const defaults = AUTOMATIC_PORTFOLIOS[role];
      return [{
        portfolioType: role,
        name: defaults.name,
        baseCurrency: defaults.baseCurrency,
        investmentObjective: mandate.objective,
      }];
    }
    const baseCurrency = normalizeThesisMandateCurrency(mandate.currency);
    if (isUnspecifiedThesisMandateCurrency(baseCurrency) || !/^[A-Z]{3}$/.test(baseCurrency)) {
      throw new ThesisPortfolioConfigurationError(
        `${titleCaseRole(mandate.role)} needs a three-letter base currency before it can be created. Set the mandate currency during human review.`
      );
    }
    return [{
      portfolioType: mandate.role,
      name: titleCaseRole(mandate.role),
      baseCurrency,
      investmentObjective: mandate.objective,
    }];
  });
}
