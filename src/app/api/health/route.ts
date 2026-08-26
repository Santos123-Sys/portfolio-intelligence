import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const env = getEnv();
    return NextResponse.json({
      status: 'ok',
      provider: env.MARKET_DATA_PROVIDER,
      agentVersion: env.AGENT_VERSION,
      llmConfigured: Boolean(env.ANTHROPIC_API_KEY),
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { status: 'misconfigured', error: (e as Error).message },
      { status: 500 }
    );
  }
}
