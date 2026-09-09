import type { ThesisCriteria } from '@portfolio-intelligence/agentic-contract';

const AUTOMATIC_PORTFOLIOS = {
  swiss_quality: { name: 'Swiss Quality', baseCurrency: 'CHF' },
  brazilian_growth: { name: 'Brazilian Growth', baseCurrency: 'BRL' },
} as const;

export type AutomaticPortfolioRole = keyof typeof AUTOMATIC_PORTFOLIOS;

/**
 * The thesis owns the investment mandate. These containers are therefore
 * created from a confirmed mandate, rather than asking the user to duplicate
 * its role and native currency in a separate setup form.
 */
export function portfoliosRequiredByThesis(criteria: ThesisCriteria) {
  return criteria.portfolios.flatMap((mandate) => {
    if (!(mandate.role in AUTOMATIC_PORTFOLIOS)) return [];
    const role = mandate.role as AutomaticPortfolioRole;
    const defaults = AUTOMATIC_PORTFOLIOS[role];
    return [{
      portfolioType: role,
      name: defaults.name,
      baseCurrency: defaults.baseCurrency,
      investmentObjective: mandate.objective,
    }];
  });
}
