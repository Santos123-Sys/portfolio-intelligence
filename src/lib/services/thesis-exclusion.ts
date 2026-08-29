import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { thesisVersions } from '@/lib/db/schema';
import { externalThesisExtractions, thesisMutationAudit } from '@/lib/db/workflow-schema';

export class ThesisVersionNotFoundError extends Error {}

export async function excludeThesisVersion(input: {
  ownerId: string;
  thesisVersionId: string;
  actor: string;
}) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.ownerId}))`);

    const [version] = await tx.select().from(thesisVersions).where(and(
      eq(thesisVersions.id, input.thesisVersionId),
      eq(thesisVersions.ownerId, input.ownerId)
    )).limit(1);
    if (!version) throw new ThesisVersionNotFoundError('Thesis version not found');

    const now = new Date();
    const wasActive = version.supersededAt === null;
    let activatedVersion: typeof version | null = null;

    if (!version.excludedAt) {
      await tx.update(thesisVersions).set({
        excludedAt: now,
        excludedBy: input.actor,
        supersededAt: version.supersededAt ?? now,
      }).where(and(
        eq(thesisVersions.id, version.id),
        eq(thesisVersions.ownerId, input.ownerId),
        isNull(thesisVersions.excludedAt)
      ));

      await tx.insert(thesisMutationAudit).values({
        thesisVersionId: version.id,
        ownerId: input.ownerId,
        action: 'excluded_thesis_version',
        actor: input.actor,
        metadata: { versionNumber: version.versionNumber },
      });
    } else if (wasActive) {
      await tx.update(thesisVersions).set({ supersededAt: now }).where(and(
        eq(thesisVersions.id, version.id),
        eq(thesisVersions.ownerId, input.ownerId)
      ));
    }

    await tx.update(externalThesisExtractions).set({
      dismissedAt: now,
      dismissedBy: input.actor,
      resultJson: null,
      errorMessage: null,
    }).where(and(
      eq(externalThesisExtractions.ownerId, input.ownerId),
      eq(externalThesisExtractions.confirmedThesisVersionId, version.id)
    ));

    if (wasActive) {
      const [fallback] = await tx.select().from(thesisVersions).where(and(
        eq(thesisVersions.ownerId, input.ownerId),
        ne(thesisVersions.id, version.id),
        isNull(thesisVersions.excludedAt)
      )).orderBy(desc(thesisVersions.versionNumber)).limit(1);
      activatedVersion = fallback ?? null;
      if (activatedVersion) {
        await tx.update(thesisVersions).set({ supersededAt: null }).where(and(
          eq(thesisVersions.id, activatedVersion.id),
          eq(thesisVersions.ownerId, input.ownerId),
          isNull(thesisVersions.excludedAt)
        ));
      }
    }

    return {
      excludedVersionId: version.id,
      excludedVersionNumber: version.versionNumber,
      activatedVersionId: activatedVersion?.id ?? null,
      activatedVersionNumber: activatedVersion?.versionNumber ?? null,
      alreadyExcluded: Boolean(version.excludedAt),
    };
  });
}
