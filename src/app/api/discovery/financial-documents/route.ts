import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-auth';
import { assertSameOrigin } from '@/lib/auth';
import { db } from '@/lib/db';
import { discoveryCandidates, financialDocumentDrafts } from '@/lib/db/workflow-schema';
import { validateFinancialPdfDocument, DocumentValidationError } from '@/lib/document-security';
import { readBoundedJson } from '@/lib/request-body';

export const runtime = 'nodejs';
const schema = z.object({ candidateId: z.string().uuid(), fileName: z.string(), contentBase64: z.string() }).strict();
const acceptedFact = z.object({ metric: z.string(), normalized_value: z.number().finite(), currency: z.string(),
  unit_multiplier: z.number(), fiscal_period_end: z.string(), fiscal_period_start: z.string().nullable(),
  page: z.number().int().positive(), quote: z.string().min(1), value: z.number().finite() });
const resultSchema = z.object({ extraction: z.object({ issuer_name: z.string(), facts: z.array(z.unknown()), gaps: z.array(z.string()) }),
  analysis: z.object({ accepted_facts: z.array(acceptedFact).max(150), rejected_facts: z.array(z.unknown()), periods: z.array(z.unknown()), gaps: z.array(z.string()), review_required: z.literal(true) }) });

async function ownedCandidate(userId: string, candidateId: string) {
  const [candidate] = await db.select().from(discoveryCandidates).where(and(
    eq(discoveryCandidates.id, candidateId), eq(discoveryCandidates.ownerId, userId)
  )).limit(1);
  return candidate?.analysisId && candidate.securityId && candidate.currency === 'CHF'
    && (candidate.country === 'CH' || candidate.country?.toLowerCase() === 'switzerland') ? candidate : null;
}

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const candidateId = z.string().uuid().safeParse(new URL(req.url).searchParams.get('candidateId'));
  if (!candidateId.success || !await ownedCandidate(session.auth.userId, candidateId.data))
    return NextResponse.json({ error: 'Approved Swiss candidate not found' }, { status: 404 });
  const drafts = await db.select({ id: financialDocumentDrafts.id, fileName: financialDocumentDrafts.fileName,
    extractionJson: financialDocumentDrafts.extractionJson, analysisJson: financialDocumentDrafts.analysisJson,
    status: financialDocumentDrafts.status, createdAt: financialDocumentDrafts.createdAt,
  }).from(financialDocumentDrafts).where(and(eq(financialDocumentDrafts.candidateId, candidateId.data),
    eq(financialDocumentDrafts.ownerId, session.auth.userId))).orderBy(desc(financialDocumentDrafts.createdAt)).limit(5);
  return NextResponse.json({ drafts }, { headers: { 'cache-control': 'private, no-store' } });
}

export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try { assertSameOrigin(req); } catch { return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 }); }
  const body = await readBoundedJson(req, 7_000_000);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: 'Candidate and PDF required' }, { status: 400 });
  const candidate = await ownedCandidate(session.auth.userId, parsed.data.candidateId);
  if (!candidate) return NextResponse.json({ error: 'Approved Swiss/CHF candidate not found' }, { status: 404 });
  try {
    const document = validateFinancialPdfDocument({ fileName: parsed.data.fileName, contentBase64: parsed.data.contentBase64 });
    const existing = await db.select({ id: financialDocumentDrafts.id }).from(financialDocumentDrafts)
      .where(and(eq(financialDocumentDrafts.candidateId, candidate.id), eq(financialDocumentDrafts.ownerId, session.auth.userId))).limit(10);
    if (existing.length >= 10) return NextResponse.json({ error: 'Ten reports are already retained for this candidate' }, { status: 409 });
    const base = process.env.FILINGS_API_URL;
    const token = process.env.FILINGS_INTERNAL_TOKEN;
    if (!base || !token || token.length < 32) return NextResponse.json({ error: 'Swiss PDF service is not configured' }, { status: 503 });
    const response = await fetch(new URL('/v1/financial-extractions', base), {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ content_base64: document.contentBase64, file_name: document.fileName,
        expected_issuer: candidate.companyName, expected_currency: candidate.currency }),
      signal: AbortSignal.timeout(105_000), cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json({ error: `PDF extraction failed (${response.status})` }, { status: 502 });
    const extraction = resultSchema.safeParse(payload);
    if (!extraction.success) return NextResponse.json({ error: 'PDF service returned an invalid extraction contract' }, { status: 502 });
    const [draft] = await db.insert(financialDocumentDrafts).values({
      ownerId: session.auth.userId, candidateId: candidate.id, fileName: document.fileName,
      pdfBase64: document.contentBase64,
      sha256: createHash('sha256').update(Buffer.from(document.contentBase64, 'base64')).digest('hex'),
      extractionJson: extraction.data.extraction, analysisJson: extraction.data.analysis,
    }).returning({ id: financialDocumentDrafts.id });
    return NextResponse.json({ draftId: draft.id, status: 'awaiting_review' }, { status: 201 });
  } catch (error) {
    if (error instanceof DocumentValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: `PDF extraction unavailable: ${(error as Error).message}` }, { status: 502 });
  }
}
