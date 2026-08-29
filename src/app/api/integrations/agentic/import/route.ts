import { NextResponse } from 'next/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { aiAnalyses, portfolios, securities, thesisVersions } from '@/lib/db/schema';
import {
  discoveryCandidates,
  externalAgenticAnalyses,
  externalAgenticRuns,
  portfolioAnalysisSyntheses,
} from '@/lib/db/workflow-schema';
import { assertAgenticServiceAuthorized } from '@/lib/auth';
import { manifestHash, validateManifest } from '@/lib/integrations/agentic-adapter';
import {
  AgenticRunRequest,
  validateManifestAgainstRequest,
} from '@/lib/integrations/agentic-contract';
import { readBoundedJson } from '@/lib/request-body';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    assertAgenticServiceAuthorized(req);
  } catch {
    return NextResponse.json({ error: 'Agentic service authentication required' }, { status: 401 });
  }

  let parsed;
  try {
    const body = await readBoundedJson(req, 10 * 1024 * 1024);
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
    parsed = validateManifest(body.value);
  } catch (e) {
    return NextResponse.json(
      { error: 'Invalid Agentic System handoff', detail: (e as Error).message },
      { status: 400 }
    );
  }

  const [existing] = await db
    .select()
    .from(externalAgenticRuns)
    .where(eq(externalAgenticRuns.externalRunId, parsed.externalRunId))
    .limit(1);

  if (!existing) {
    return NextResponse.json(
      { error: 'Unknown externalRunId. The authenticated dashboard user must start the run before import.' },
      { status: 409 }
    );
  }

  if (parsed.status === 'failed') {
    if (existing.importedAt) {
      return NextResponse.json(
        { error: 'An imported completed run cannot transition to failed' },
        { status: 409 }
      );
    }
    const [failed] = await db
      .update(externalAgenticRuns)
      .set({
        status: 'failed',
        errorMessage: parsed.errorMessage,
        completedAt: new Date(),
      })
      .where(eq(externalAgenticRuns.id, existing.id))
      .returning();
    const failedRequest = AgenticRunRequest.safeParse(existing.requestJson);
    if (failedRequest.success && failedRequest.data.origin?.kind === 'discovery_candidate') {
      await db.update(discoveryCandidates).set({
        workflowStatus: 'analysis_failed',
        updatedAt: new Date(),
      }).where(and(
        eq(discoveryCandidates.id, failedRequest.data.origin.candidateId!),
        eq(discoveryCandidates.ownerId, existing.ownerId)
      ));
    }
    return NextResponse.json({ run: failed, imported: false, idempotent: existing.status === 'failed' });
  }

  const hash = manifestHash(parsed.manifest);
  if (existing.manifestHash && existing.manifestHash !== hash) {
    return NextResponse.json(
      { error: 'externalRunId was reused with a different manifest' },
      { status: 409 }
    );
  }
  if (existing.importedAt) {
    return NextResponse.json({
      run: existing,
      imported: true,
      idempotent: true,
    });
  }

  const request = AgenticRunRequest.safeParse(existing.requestJson);
  if (!request.success) {
    return NextResponse.json({ error: 'Stored run request is missing or invalid' }, { status: 409 });
  }
  try {
    validateManifestAgainstRequest(parsed.manifest, request.data);
  } catch (error) {
    return NextResponse.json(
      { error: 'Manifest does not match the dashboard-supplied run evidence', detail: (error as Error).message },
      { status: 422 }
    );
  }

  const [thesis] = await db
    .select({ id: thesisVersions.id })
    .from(thesisVersions)
    .where(and(
      eq(thesisVersions.ownerId, existing.ownerId),
      eq(thesisVersions.id, request.data.thesis.versionId),
      eq(thesisVersions.versionNumber, parsed.manifest.thesisVersion),
      isNull(thesisVersions.excludedAt)
    ))
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
        .update(externalAgenticRuns)
        .set({
          status: 'importing',
          thesisVersion: String(parsed.manifest.thesisVersion),
          manifestSchemaVersion: parsed.manifest.schemaVersion,
          manifestHash: hash,
          manifestJson: parsed.manifest,
          reportPdfUrl: parsed.reportPdfUrl,
          completedAt: new Date(parsed.manifest.generatedAt),
        })
        .where(eq(externalAgenticRuns.id, existing.id))
        .returning();

      let analysisCount = 0;
      for (const portfolioManifest of parsed.manifest.portfolios) {
        const [portfolio] = await tx
          .select({ id: portfolios.id })
          .from(portfolios)
          .where(and(
            eq(portfolios.id, portfolioManifest.portfolioId),
            eq(portfolios.ownerId, existing.ownerId)
          ))
          .limit(1);
        if (!portfolio) throw new Error(`Unknown portfolio: ${portfolioManifest.portfolioId}`);

        await tx.insert(portfolioAnalysisSyntheses).values({
          runId: run.id,
          portfolioId: portfolio.id,
          thesisVersion: String(parsed.manifest.thesisVersion),
          synthesisJson: portfolioManifest.synthesis,
        });

        for (const output of portfolioManifest.analyses) {
          const requestedSecurity = request.data.securities.filter((security) =>
            security.portfolioId === portfolioManifest.portfolioId && security.ticker === output.ticker
          );
          if (requestedSecurity.length !== 1) {
            throw new Error(`Ticker ${output.ticker} was not uniquely present in the dashboard run request`);
          }
          const securitiesForTicker = await tx
            .select()
            .from(securities)
            .where(and(
              eq(securities.ticker, output.ticker),
              eq(securities.exchange, requestedSecurity[0].exchange)
            ));
          if (securitiesForTicker.length !== 1) {
            throw new Error(
              `Security ticker ${output.ticker} must resolve to exactly one dashboard security; found ${securitiesForTicker.length}`
            );
          }
          const security = securitiesForTicker[0];
          const grounding = request.data.groundingBundles.find((item) =>
            item.portfolioId === portfolio.id && item.bundle.ticker === output.ticker
          );
          if (!grounding) throw new Error(`Grounding bundle missing for ${output.ticker}`);
          const [previous] = await tx
            .select({ id: aiAnalyses.id })
            .from(aiAnalyses)
            .where(and(
              eq(aiAnalyses.ownerId, existing.ownerId),
              eq(aiAnalyses.portfolioId, portfolio.id),
              eq(aiAnalyses.securityId, security.id)
            ))
            .orderBy(desc(aiAnalyses.analysisTimestamp))
            .limit(1);

          const [analysis] = await tx
            .insert(aiAnalyses)
            .values({
              ownerId: existing.ownerId,
              portfolioId: portfolio.id,
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
              dataTimestamp: new Date(grounding.bundle.dataAsOf),
              agentVersion: 'external-agentic-system',
            })
            .returning();

          await tx.insert(externalAgenticAnalyses).values({
            runId: run.id,
            portfolioId: portfolio.id,
            securityId: security.id,
            analysisId: analysis.id,
            outputJson: output,
          });
          if (request.data.origin?.kind === 'discovery_candidate') {
            await tx.update(discoveryCandidates).set({
              analysisId: analysis.id,
              workflowStatus: 'analysis_complete',
              updatedAt: new Date(),
            }).where(and(
              eq(discoveryCandidates.id, request.data.origin.candidateId!),
              eq(discoveryCandidates.ownerId, existing.ownerId)
            ));
          }
          analysisCount += 1;
        }
      }

      const [imported] = await tx
        .update(externalAgenticRuns)
        .set({ status: 'imported', importedAt: new Date() })
        .where(eq(externalAgenticRuns.id, run.id))
        .returning();

      return { run: imported, analysisCount, actor: 'agentic-service' };
    });

    return NextResponse.json({ ...result, imported: true }, { status: 201 });
  } catch (e) {
    const [current] = await db.select().from(externalAgenticRuns)
      .where(eq(externalAgenticRuns.id, existing.id)).limit(1);
    if (current?.importedAt && current.manifestHash === hash) {
      return NextResponse.json({ run: current, imported: true, idempotent: true });
    }
    return NextResponse.json(
      { error: `Agentic manifest import failed: ${(e as Error).message}` },
      { status: 422 }
    );
  }
}
