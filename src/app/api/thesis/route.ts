import { NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { thesisVersions } from '@/lib/db/schema';

export const runtime = 'nodejs';

export async function GET() {
  const versions = await db.select().from(thesisVersions).orderBy(desc(thesisVersions.versionNumber));
  return NextResponse.json({ versions });
}
