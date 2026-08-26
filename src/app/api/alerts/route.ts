import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { alerts } from '@/lib/db/schema';
import { authenticateRequest } from '@/lib/api-auth';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const rows = await db.select().from(alerts)
    .where(eq(alerts.ownerId, session.auth.userId))
    .orderBy(desc(alerts.createdAt));
  return NextResponse.json({ alerts: rows });
}
