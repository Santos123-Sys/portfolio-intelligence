import { NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  ThesisCriteria,
  ThesisExtractionResult,
} from '@portfolio-intelligence/agentic-contract';
import { z } from 'zod';
import { db } from '@/lib/db';
import { thesisVersions } from '@/lib/db/schema';
import { externalThesisExtractions, thesisMutationAudit } from '@/lib/db/workflow-schema';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';

export const runtime = 'nodejs';

const thesisMutationSchema = z.object({
  externalExtractionId: z.string().min(1).optional(),
  rawDocument: z.string().min(1).max(100_000).optional(),
  criteriaJson: ThesisCriteria,
}).strict();

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

  const parsed = thesisMutationSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const version = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${session.auth.userId}))`);
      const [latest] = await tx.select().from(thesisVersions)
        .where(eq(thesisVersions.ownerId, session.auth.userId))
        .orderBy(desc(thesisVersions.versionNumber)).limit(1);
      const nextVersion = (latest?.versionNumber ?? 0) + 1;
      if (parsed.data.criteriaJson.version !== nextVersion) {
        throw new ConfirmationError(`Confirmed criteria must be thesis version ${nextVersion}`);
      }

      let extractionId: string | null = null;
      if (parsed.data.externalExtractionId) {
        const [extraction] = await tx.select().from(externalThesisExtractions).where(and(
          eq(externalThesisExtractions.externalExtractionId, parsed.data.externalExtractionId),
          eq(externalThesisExtractions.ownerId, session.auth.userId)
        )).limit(1);
        if (!extraction || extraction.status !== 'completed' || extraction.confirmedAt) {
          throw new ConfirmationError('Extraction is unavailable, incomplete, or already confirmed');
        }
        const extracted = ThesisExtractionResult.safeParse(extraction.resultJson);
        if (!extracted.success || extracted.data.criteria.version !== nextVersion || extraction.requestedVersion !== nextVersion) {
          throw new ConfirmationError('Extraction version does not match the next canonical thesis version');
        }
        extractionId = extraction.id;
      }

      if (latest && !latest.supersededAt) {
        await tx.update(thesisVersions).set({ supersededAt: new Date() })
          .where(and(eq(thesisVersions.id, latest.id), eq(thesisVersions.ownerId, session.auth.userId)));
      }
      const [created] = await tx.insert(thesisVersions).values({
        ownerId: session.auth.userId,
        versionNumber: nextVersion,
        criteriaJson: parsed.data.criteriaJson,
        rawDocument: parsed.data.rawDocument,
      }).returning();
      await tx.insert(thesisMutationAudit).values({
        thesisVersionId: created.id,
        ownerId: session.auth.userId,
        action: extractionId ? 'confirmed_external_extraction' : 'confirmed_manual_criteria',
        actor: session.auth.email,
        metadata: {
          supersededVersionId: latest?.id ?? null,
          externalExtractionId: parsed.data.externalExtractionId ?? null,
        },
      });
      if (extractionId) {
        await tx.update(externalThesisExtractions).set({
          confirmedAt: new Date(),
          confirmedThesisVersionId: created.id,
        }).where(eq(externalThesisExtractions.id, extractionId));
      }
      return created;
    });
    return NextResponse.json({ version }, { status: 201 });
  } catch (error) {
    if (error instanceof ConfirmationError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: 'Unable to confirm thesis version' }, { status: 500 });
  }
}

class ConfirmationError extends Error {}
