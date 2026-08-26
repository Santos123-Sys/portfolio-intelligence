import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';

export const runtime = 'nodejs';

export async function GET() {
  const env = getEnv();
  return NextResponse.json({
    readMode: 'public-preview',
    mutationAuth: env.MUTATION_API_KEY ? 'api-key-required' : env.NODE_ENV === 'production' ? 'misconfigured' : 'development-open',
    note: 'This is a temporary API-key write boundary. Replace with user/session authentication before production portfolio data is stored.',
  });
}
