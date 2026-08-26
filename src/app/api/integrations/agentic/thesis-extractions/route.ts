import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { thesisVersions } from '@/lib/db/schema';
import { externalThesisExtractions } from '@/lib/db/workflow-schema';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import {
  fetchExternalThesisExtraction,
  retryExternalAgenticJob,
  startExternalThesisExtraction,
} from '@/lib/integrations/agentic-client';

export const runtime = 'nodejs';

const uploadSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(['application/pdf', 'text/plain', 'text/markdown']),
  contentBase64: z.string().min(1),
}).strict();

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const externalExtractionId = new URL(req.url).searchParams.get('externalExtractionId');
  if (!externalExtractionId) {
    const extractions = await db.select().from(externalThesisExtractions)
      .where(eq(externalThesisExtractions.ownerId, session.auth.userId))
      .orderBy(desc(externalThesisExtractions.requestedAt))
      .limit(20);
    return NextResponse.json({ extractions });
  }

  const [local] = await db.select().from(externalThesisExtractions).where(and(
    eq(externalThesisExtractions.externalExtractionId, externalExtractionId),
    eq(externalThesisExtractions.ownerId, session.auth.userId)
  )).limit(1);
  if (!local) return NextResponse.json({ error: 'Thesis extraction not found' }, { status: 404 });

  try {
    const remote = await fetchExternalThesisExtraction(externalExtractionId);
    const [updated] = await db.update(externalThesisExtractions).set({
      status: remote.status,
      resultJson: remote.result,
      errorMessage: remote.errorMessage,
      completedAt: remote.status === 'completed' || remote.status === 'failed' ? new Date() : local.completedAt,
    }).where(eq(externalThesisExtractions.id, local.id)).returning();
    return NextResponse.json({ extraction: updated, remote });
  } catch (error) {
    return NextResponse.json({ extraction: local, remoteError: (error as Error).message });
  }
}

export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 });
  }
  const parsed = uploadSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const bytes = Buffer.from(parsed.data.contentBase64, 'base64');
  if (!bytes.length || bytes.length > 50 * 1024 * 1024) {
    return NextResponse.json({ error: 'Thesis document must contain 1 byte to 50 MB' }, { status: 413 });
  }

  const [latest] = await db.select({ versionNumber: thesisVersions.versionNumber })
    .from(thesisVersions)
    .where(eq(thesisVersions.ownerId, session.auth.userId))
    .orderBy(desc(thesisVersions.versionNumber))
    .limit(1);
  const requestedVersion = (latest?.versionNumber ?? 0) + 1;
  try {
    const remote = await startExternalThesisExtraction({
      document: { ...parsed.data, version: requestedVersion },
    });
    const [extraction] = await db.insert(externalThesisExtractions).values({
      ownerId: session.auth.userId,
      externalExtractionId: remote.externalExtractionId,
      status: remote.status,
      requestedVersion,
      sourceFileName: parsed.data.fileName,
      sourceMimeType: parsed.data.mimeType,
      resultJson: remote.result,
      errorMessage: remote.errorMessage,
    }).returning();
    return NextResponse.json({ extraction, remote }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

export async function PATCH(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 });
  }
  const externalExtractionId = new URL(req.url).searchParams.get('externalExtractionId');
  if (!externalExtractionId) {
    return NextResponse.json({ error: 'externalExtractionId is required' }, { status: 400 });
  }
  const [local] = await db.select().from(externalThesisExtractions).where(and(
    eq(externalThesisExtractions.externalExtractionId, externalExtractionId),
    eq(externalThesisExtractions.ownerId, session.auth.userId)
  )).limit(1);
  if (!local) return NextResponse.json({ error: 'Thesis extraction not found' }, { status: 404 });
  if (local.status !== 'failed') {
    return NextResponse.json({ error: 'Only failed extractions can be retried' }, { status: 409 });
  }
  try {
    const remote = await retryExternalAgenticJob('thesis-extractions', externalExtractionId);
    const [extraction] = await db.update(externalThesisExtractions).set({
      status: remote.status,
      errorMessage: null,
      completedAt: null,
    }).where(eq(externalThesisExtractions.id, local.id)).returning();
    return NextResponse.json({ extraction, remote }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
