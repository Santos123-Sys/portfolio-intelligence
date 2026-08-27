import { NextResponse } from 'next/server';
import { asc, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { securities } from '@/lib/db/schema';
import { authenticateRequest, ownedSecurityIds } from '@/lib/api-auth';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const ids = await ownedSecurityIds(session.auth.userId);
  const items = ids.length === 0
    ? []
    : await db.select().from(securities)
        .where(inArray(securities.id, ids))
        .orderBy(asc(securities.companyName));
  return NextResponse.json({ securities: items });
}
