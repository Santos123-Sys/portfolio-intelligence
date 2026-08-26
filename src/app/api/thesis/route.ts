import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { thesisVersions } from '@/lib/db/schema';
import { thesisMutationAudit } from '@/lib/db/workflow-schema';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';

export const runtime = 'nodejs';

const thesisMutationSchema = z.object({
  rawDocument: z.string().min(1).optional(),
  criteriaJson: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const versions = await db.select().from(thesisVersions)
    .where(eq(thesisVersions.ownerId, session.auth.userId))
    .orderBy(desc(thesisVersions.versionNumber));
  return NextResponse.json({ versions });
}

export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 });
  }

  const parsed = thesisMutationSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { rawDocument, criteriaJson } = parsed.data;
  if (!rawDocument && !criteriaJson) {
    return NextResponse.json({ error: 'Provide rawDocument and/or criteriaJson' }, { status: 400 });
  }

  const [latest] = await db.select().from(thesisVersions)
    .where(eq(thesisVersions.ownerId, session.auth.userId))
    .orderBy(desc(thesisVersions.versionNumber)).limit(1);
  const nextVersion = (latest?.versionNumber ?? 0) + 1;

  if (latest && !latest.supersededAt) {
    await db.update(thesisVersions).set({ supersededAt: new Date() })
      .where(and(eq(thesisVersions.id, latest.id), eq(thesisVersions.ownerId, session.auth.userId)));
  }

  const criteria = criteriaJson ?? {
    source: 'manual_thesis_upload',
    extractionStatus: 'UNSTRUCTURED_REQUIRES_EXTERNAL_AGENTIC_INTERPRETATION',
    createdAt: new Date().toISOString(),
  };

  const [version] = await db
    .insert(thesisVersions)
    .values({ ownerId: session.auth.userId, versionNumber: nextVersion, criteriaJson: criteria, rawDocument })
    .returning();

  await db.insert(thesisMutationAudit).values({
    thesisVersionId: version.id,
    ownerId: session.auth.userId,
    action: 'created',
    actor: session.auth.email,
    metadata: { supersededVersionId: latest?.id ?? null },
  });

  return NextResponse.json({ version }, { status: 201 });
}
