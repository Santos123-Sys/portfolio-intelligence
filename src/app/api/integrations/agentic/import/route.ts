import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { aiAnalyses, portfolios, securities, thesisVersions } from '@/lib/db/schema';
import {
  externalAgenticAnalyses,
  externalAgenticRuns,
  portfolioAnalysisSyntheses,
} from '@/lib/db/workflow-schema';
import { assertMutationAuthorized } from '@/lib/auth';
import { manifestHash, validateManifest } from '@/lib/integrations/agentic-adapter';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let actor: string;
  try {
    actor = assertMutationAuthorized(req).subject;
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }

  const parsed = validateManifest(await req.json().catch(() => ({})));
  const hash = manifestHash(parsed.manifest);

  const [existing] = await db
    .select()
    .from(externalAgenticRuns)
    .where(eq(externalAgenticRuns.externalRunId, parsed.externalRunId))
    .limit(1);

  if (existing) {
    return NextResponse.json({
      run: existing,
      imported: Boolean(existing.importedAt),
      idempotent: true,
    });
  }

  const [thesis] = await db
    .select({ id: thesisVersions.id })
    .from(thesisVersions)
    .where(eq(thesisVersions.versionNumber, parsed.manifest.thesisVersion))
    .limit(1);

  if (!thesis) {
    return NextResponse.json(
      { error: `Thesis version ${parsed.manifest.thesisVersion} does not exist in the dashboard` },
      { status: 409 }
    );
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [run] = await tx
        .insert(externalAgenticRuns)
        .values({
          externalRunId: parsed.externalRunId,
          status: 'importing',
          thesisVersion: String(parsed.manifest.thesisVersion),
          manifestSchemaVersion: parsed.manifest.schemaVersion,
          manifestHash: hash,
          manifestJson: parsed.manifest,
          reportPdfUrl: parsed.reportPdfUrl,
          completedAt: new Date(parsed.manifest.generatedAt),
        })
        .returning();

      let analysisCount = 0;
      for (const portfolioManifest of parsed.manifest.portfolios) {
        const [portfolio] = await tx
          .select({ id: portfolios.id })
          .from(portfolios)
          .where(eq(portfolios.id, portfolioManifest.portfolioId))
          .limit(1);
        if (!portfolio) throw new Error(`Unknown portfolio: ${portfolioManifest.portfolioId}`);

        await tx.insert(portfolioAnalysisSyntheses).values({
          runId: run.id,
          portfolioId: portfolio.id,
          thesisVersion: String(parsed.manifest.thesisVersion),
          synthesisJson: portfolioManifest.synthesis,
        });

        for (const output of portfolioManifest.analyses) {
          const securitiesForTicker = await tx
            .select()
            .from(securities)
            .where(eq(securities.ticker, output.ticker));
          if (securitiesForTicker.length !== 1) {
            throw new Error(
              `Security ticker ${output.ticker} must resolve to exactly one dashboard security; found ${securitiesForTicker.length}`
            );
          }
          const security = securitiesForTicker[0];
          const [previous] = await tx
            .select({ id: aiAnalyses.id })
            .from(aiAnalyses)
            .where(eq(aiAnalyses.securityId, security.id))
            .orderBy(desc(aiAnalyses.analysisTimestamp))
            .limit(1);

          const [analysis] = await tx
            .insert(aiAnalyses)
            .values({
              securityId: security.id,
              thesisVersionId: thesis.id,
              portfolioCandidate: output.portfolioCandidate,
              portfolioRole: output.portfolioRole,
              investmentScore: output.investmentScore,
              thesisAlignmentScore: output.thesisAlignmentScore,
              qualityScore: output.qualityScore,
              growthScore: output.growthScore,
              riskScore: output.riskScore,
              dividendScore: output.dividendScore,
              fundamentalSummary: output.fundamentalSummary,
              investmentThesis: output.investmentThesis,
              keyCatalysts: output.keyCatalysts,
              keyRisks: output.keyRisks,
              thesisBreakers: output.thesisBreakers,
              confidenceScore: output.confidenceScore,
              groundedIn: output.groundedIn,
              informationGaps: output.informationGaps,
              externalRunId: run.id,
              supersedesId: previous?.id ?? null,
              analysisTimestamp: new Date(parsed.manifest.generatedAt),
              dataTimestamp: new Date(parsed.manifest.generatedAt),
              agentVersion: 'external-agentic-system',
            })
            .returning();

          await tx.insert(externalAgenticAnalyses).values({
            runId: run.id,
            securityId: security.id,
            analysisId: analysis.id,
            outputJson: output,
          });
          analysisCount += 1;
        }
      }

      const [imported] = await tx
        .update(externalAgenticRuns)
        .set({ status: 'imported', importedAt: new Date() })
        .where(eq(externalAgenticRuns.id, run.id))
        .returning();

      return { run: imported, analysisCount, actor };
    });

    return NextResponse.json({ ...result, imported: true }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: `Agentic manifest import failed: ${(e as Error).message}` },
      { status: 422 }
    );
  }
}
