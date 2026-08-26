import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { requireSession, type AuthContext } from './auth';
import { db } from './db';
import { aiAnalyses, portfolios, positions } from './db/schema';

export type AuthenticationResult =
  | { ok: true; auth: AuthContext }
  | { ok: false; response: NextResponse };

export async function authenticateRequest(req: Request): Promise<AuthenticationResult> {
  try {
    return { ok: true, auth: await requireSession(req) };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    };
  }
}

export async function portfolioIsOwned(userId: string, portfolioId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: portfolios.id })
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.ownerId, userId)))
    .limit(1);
  return Boolean(row);
}

export async function ownedSecurityIds(userId: string): Promise<string[]> {
  const [positionRows, analysisRows] = await Promise.all([
    db
      .select({ securityId: positions.securityId })
      .from(positions)
      .innerJoin(portfolios, eq(positions.portfolioId, portfolios.id))
      .where(eq(portfolios.ownerId, userId)),
    db
      .select({ securityId: aiAnalyses.securityId })
      .from(aiAnalyses)
      .where(eq(aiAnalyses.ownerId, userId)),
  ]);
  return [...new Set([...positionRows, ...analysisRows].map((row) => row.securityId))];
}
