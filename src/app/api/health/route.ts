import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({
      status: 'ok',
      database: 'reachable',
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { status: 'unhealthy', database: 'unreachable', timestamp: new Date().toISOString() },
      { status: 503 }
    );
  }
}
