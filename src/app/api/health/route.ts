import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { getEnv } from '@/lib/env';

export const runtime = 'nodejs';

export async function GET() {
  try {
    // Build-time route discovery is intentionally environment-independent;
    // runtime health remains strict and verifies every required setting.
    getEnv();
    await db.execute(sql`select 1`);
    return NextResponse.json({
      status: 'ok',
      database: 'reachable',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[health] Runtime configuration or database check failed', {
      error: error instanceof Error ? error.message : 'Unknown health-check failure',
    });
    return NextResponse.json(
      {
        status: 'unhealthy',
        database: 'unreachable',
        configuration: 'invalid-or-unreachable',
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
