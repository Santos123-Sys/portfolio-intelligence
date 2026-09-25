import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { financialDocumentDrafts } from '@/lib/db/workflow-schema';

export const runtime = 'nodejs';
export async function GET(req: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const { draftId } = await params;
  if (!z.string().uuid().safeParse(draftId).success) return NextResponse.json({ error: 'Valid draft ID required' }, { status: 400 });
  const [document] = await db.select({ pdfBase64: financialDocumentDrafts.pdfBase64,
    fileName: financialDocumentDrafts.fileName }).from(financialDocumentDrafts)
    .where(and(eq(financialDocumentDrafts.id, draftId), eq(financialDocumentDrafts.ownerId, session.auth.userId))).limit(1);
  if (!document) return NextResponse.json({ error: 'PDF not found' }, { status: 404 });
  const bytes = Buffer.from(document.pdfBase64, 'base64');
  return new Response(new Uint8Array(bytes), { headers: {
    'content-type': 'application/pdf', 'content-disposition': `inline; filename="${document.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
    'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
  } });
}
