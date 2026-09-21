import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import { DocumentValidationError, validateThesisDocument } from '@/lib/document-security';
import { db } from '@/lib/db';
import { thesisVersions } from '@/lib/db/schema';
import { externalThesisExtractions } from '@/lib/db/workflow-schema';
import { getActiveAgentCustomization } from '@/lib/agent-config';
import { startExternalThesisExtraction } from '@/lib/integrations/agentic-client';
import { readBoundedJson } from '@/lib/request-body';
import { generatedThesisFileName, renderGeneratedThesisPdf } from '@/lib/thesis-generator';

export const runtime = 'nodejs';
const text = (name: string, max: number) => z.string().trim().min(2, `${name} is required`).max(max);
const item = z.string().trim().min(1).max(300);
const schema = z.object({
  title: text('Thesis title', 120), investorName: text('Investor name', 120), purpose: text('Investment purpose', 2_000),
  timeHorizon: text('Time horizon', 120), riskTolerance: text('Risk tolerance', 120), markets: z.array(item).min(1).max(12),
  globalConstraints: z.array(item).max(20), reviewCadence: text('Review cadence', 120),
  mandates: z.array(z.object({
    label: text('Portfolio destination', 100), currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Each portfolio needs a three-letter base currency'),
    objective: text('Portfolio objective', 1_000), inclusionCriteria: z.array(item).max(20), exclusionCriteria: z.array(item).max(20),
  }).strict()).min(1).max(8),
}).strict();

function roleFromLabel(label: string): string {
  const role = label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[a-z][a-z0-9_]{1,63}$/.test(role) ? role : '';
}

export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try { assertSameOrigin(req); } catch { return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 }); }
  const body = await readBoundedJson(req, 64 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const roles = parsed.data.mandates.map((mandate) => roleFromLabel(mandate.label));
  if (roles.some((role) => !role) || new Set(roles).size !== roles.length) {
    return NextResponse.json({ error: 'Portfolio destination names must produce distinct, readable identifiers' }, { status: 400 });
  }
  try {
    const pdf = await renderGeneratedThesisPdf({ ...parsed.data, mandates: parsed.data.mandates.map((mandate, index) => ({ ...mandate, role: roles[index]! })) });
    const document = validateThesisDocument({ fileName: generatedThesisFileName(parsed.data.title), mimeType: 'application/pdf', contentBase64: pdf.toString('base64') });
    const [latest] = await db.select({ versionNumber: thesisVersions.versionNumber }).from(thesisVersions)
      .where(eq(thesisVersions.ownerId, session.auth.userId)).orderBy(desc(thesisVersions.versionNumber)).limit(1);
    const requestedVersion = (latest?.versionNumber ?? 0) + 1;
    const agentConfig = await getActiveAgentCustomization(session.auth.userId, 'thesis_extraction');
    const remote = await startExternalThesisExtraction({ document: { ...document, version: requestedVersion }, agentConfig });
    const [extraction] = await db.insert(externalThesisExtractions).values({
      ownerId: session.auth.userId, externalExtractionId: remote.externalExtractionId, status: remote.status, requestedVersion,
      sourceFileName: document.fileName, sourceMimeType: document.mimeType, resultJson: remote.result, errorMessage: remote.errorMessage,
    }).returning();
    return NextResponse.json({ extraction, remote, generatedDocument: { fileName: document.fileName, contentBase64: document.contentBase64 } }, { status: 202 });
  } catch (error) {
    if (error instanceof DocumentValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to generate the investment thesis' }, { status: 502 });
  }
}
