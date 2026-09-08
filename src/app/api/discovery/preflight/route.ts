import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import { preflightDiscoveryForOwner } from '@/lib/discovery-workflow';

export const runtime = 'nodejs';

const preflightSchema = z.object({
  maxCandidatesPerPortfolio: z.number().int().min(1).max(7).default(6),
}).strict();

export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 });
  }
  const parsed = preflightSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const preflight = await preflightDiscoveryForOwner(session.auth.userId, parsed.data.maxCandidatesPerPortfolio);
  return NextResponse.json({ preflight }, { status: preflight.ready ? 200 : 422 });
}
