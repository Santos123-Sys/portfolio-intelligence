import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { aiAnalyses } from '@/lib/db/schema';
import { authenticateRequest } from '@/lib/api-auth';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const securityId = new URL(req.url).searchParams.get('securityId');
  const rows = securityId
    ? await db.select().from(aiAnalyses).where(and(eq(aiAnalyses.ownerId, session.auth.userId), eq(aiAnalyses.securityId, securityId))).orderBy(desc(aiAnalyses.analysisTimestamp))
    : await db.select().from(aiAnalyses).where(eq(aiAnalyses.ownerId, session.auth.userId)).orderBy(desc(aiAnalyses.analysisTimestamp));
  return NextResponse.json({ analyses: rows });
}
