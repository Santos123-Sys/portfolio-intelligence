import { NextResponse } from 'next/server';
import { asc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { securities } from '@/lib/db/schema';

export const runtime = 'nodejs';

export async function GET() {
  const items = await db.select().from(securities).orderBy(asc(securities.companyName));
  return NextResponse.json({ securities: items });
}
