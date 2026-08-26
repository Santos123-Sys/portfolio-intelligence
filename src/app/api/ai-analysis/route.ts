import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { aiAnalyses } from '@/lib/db/schema';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const securityId = new URL(req.url).searchParams.get('securityId');
  const rows = securityId
    ? await db.select().from(aiAnalyses).where(eq(aiAnalyses.securityId, securityId)).orderBy(desc(aiAnalyses.analysisTimestamp))
    : await db.select().from(aiAnalyses).orderBy(desc(aiAnalyses.analysisTimestamp));
  return NextResponse.json({ analyses: rows });
}
