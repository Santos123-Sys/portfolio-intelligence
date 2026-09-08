import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import { buildGovernanceDashboard, saveGovernancePolicy } from '@/lib/governance';
import { readBoundedJson } from '@/lib/request-body';

export const runtime = 'nodejs';

const policySchema = z.object({
  maxPositionWeight: z.number().min(0.02).max(1),
  maxSectorWeight: z.number().min(0.05).max(1),
  maxCountryWeight: z.number().min(0.05).max(1),
  minimumHoldings: z.number().int().min(1).max(100),
  stalePriceDays: z.number().int().min(1).max(30),
  staleResearchDays: z.number().int().min(7).max(730),
  reviewIntervalDays: z.number().int().min(7).max(365),
}).strict().superRefine((policy, context) => {
  if (policy.maxPositionWeight > policy.maxSectorWeight) context.addIssue({ code: 'custom', path: ['maxPositionWeight'], message: 'Maximum position weight cannot exceed maximum sector weight.' });
});

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  return NextResponse.json(await buildGovernanceDashboard(session.auth.userId));
}

export async function PUT(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 });
  }
  const body = await readBoundedJson(req, 8 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = policySchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const policy = await saveGovernancePolicy(session.auth.userId, parsed.data);
  return NextResponse.json({ policy });
}
