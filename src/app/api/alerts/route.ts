import { NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { alerts } from '@/lib/db/schema';

export const runtime = 'nodejs';

export async function GET() {
  const rows = await db.select().from(alerts).orderBy(desc(alerts.createdAt));
  return NextResponse.json({ alerts: rows });
}
