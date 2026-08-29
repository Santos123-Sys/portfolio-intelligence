import { z } from 'zod';

const requiredText = (label: string, max: number) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`);

const upperCode = (label: string, length: number) =>
  requiredText(label, length)
    .transform((value) => value.toUpperCase())
    .pipe(z.string().regex(new RegExp(`^[A-Z]{${length}}$`), `${label} must contain ${length} letters`));

const positiveNumber = (label: string, allowZero = false) =>
  z.union([z.number(), z.string().trim().min(1)])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value), `${label} must be a number`)
    .refine((value) => allowZero ? value >= 0 : value > 0, `${label} must be ${allowZero ? 'zero or greater' : 'greater than zero'}`);

export const portfolioRoleValues = ['swiss_quality', 'brazilian_growth', 'fixed_income'] as const;

export const portfolioCreateSchema = z.object({
  name: requiredText('Portfolio name', 100),
  portfolioType: z.enum(portfolioRoleValues),
  baseCurrency: upperCode('Base currency', 3),
  investmentObjective: requiredText('Investment objective', 1_000),
}).strict();

export const holdingCreateSchema = z.object({
  portfolioId: z.string().uuid('Select a valid portfolio'),
  ticker: requiredText('Ticker', 20)
    .transform((value) => value.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9.-]*$/, 'Ticker contains unsupported characters')),
  companyName: requiredText('Company name', 160),
  exchange: upperCode('Exchange MIC', 4),
  currency: upperCode('Security currency', 3),
  sector: z.string().trim().max(100).optional(),
  country: z.string().trim().transform((value) => value.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2}$/, 'Country must be a two-letter code')).optional(),
  quantity: positiveNumber('Quantity'),
  avgCost: positiveNumber('Average cost', true),
}).strict();

export type PortfolioCreateInput = z.infer<typeof portfolioCreateSchema>;
export type HoldingCreateInput = z.infer<typeof holdingCreateSchema>;

export interface AgenticReadiness {
  ready: boolean;
  thesisVersion: number | null;
  portfolioCount: number;
  positionCount: number;
  issues: string[];
}

export function assessAgenticReadiness(input: {
  thesisVersion: number | null;
  portfolios: Array<{ id: string; name: string }>;
  positionPortfolioIds: string[];
}): AgenticReadiness {
  const issues: string[] = [];
  if (input.thesisVersion == null) issues.push('Confirm an investment thesis.');
  if (input.portfolios.length === 0) issues.push('Create at least one portfolio.');

  const portfoliosWithPositions = new Set(input.positionPortfolioIds);
  if (input.portfolios.length > 0 && input.positionPortfolioIds.length === 0) {
    issues.push('Add at least one position.');
  } else {
    for (const portfolio of input.portfolios) {
      if (!portfoliosWithPositions.has(portfolio.id)) {
        issues.push(`Add a position to ${portfolio.name}.`);
      }
    }
  }

  return {
    ready: issues.length === 0,
    thesisVersion: input.thesisVersion,
    portfolioCount: input.portfolios.length,
    positionCount: input.positionPortfolioIds.length,
    issues,
  };
}
