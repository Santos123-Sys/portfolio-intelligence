import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { thesisVersions } from '@/lib/db/schema';
import { thesisMutationAudit } from '@/lib/db/workflow-schema';
import { assertMutationAuthorized } from '@/lib/auth';

export const runtime = 'nodejs';

const thesisMutationSchema = z.object({
  rawDocument: z.string().min(1).optional(),
  criteriaJson: z.record(z.string(), z.unknown()).optional(),
});

export async function GET() {
  const versions = await db.select().from(thesisVersions).orderBy(desc(thesisVersions.versionNumber));
  return NextResponse.json({ versions });
}

export async function POST(req: Request) {
  let auth;
  try {
    auth = assertMutationAuthorized(req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }

  const parsed = thesisMutationSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { rawDocument, criteriaJson } = parsed.data;
  if (!rawDocument && !criteriaJson) {
    return NextResponse.json({ error: 'Provide rawDocument and/or criteriaJson' }, { status: 400 });
  }

  const [latest] = await db.select().from(thesisVersions).orderBy(desc(thesisVersions.versionNumber)).limit(1);
  const nextVersion = (latest?.versionNumber ?? 0) + 1;

  if (latest && !latest.supersededAt) {
    await db.update(thesisVersions).set({ supersededAt: new Date() }).where(eq(thesisVersions.id, latest.id));
  }

  const criteria = criteriaJson ?? {
    source: 'manual_thesis_upload',
    extractionStatus: 'UNSTRUCTURED_REQUIRES_AGENTEKI_INTERPRETATION',
    createdAt: new Date().toISOString(),
  };

  const [version] = await db
    .insert(thesisVersions)
    .values({ versionNumber: nextVersion, criteriaJson: criteria, rawDocument })
    .returning();

  await db.insert(thesisMutationAudit).values({
    thesisVersionId: version.id,
    action: 'created',
    actor: auth.subject,
    metadata: { authMode: auth.mode, supersededVersionId: latest?.id ?? null },
  });

  return NextResponse.json({ version }, { status: 201 });
}
