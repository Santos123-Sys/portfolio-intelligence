import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { externalAgenticRuns } from '@/lib/db/workflow-schema';
import { fetchExternalAgenticReport } from '@/lib/integrations/agentic-client';

export const runtime = 'nodejs';
const MAX_REPORT_BYTES = 20 * 1024 * 1024;

async function readReport(response: Response): Promise<Uint8Array> {
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/pdf') {
    throw new Error('External report endpoint did not return a PDF');
  }
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REPORT_BYTES) {
    throw new Error('External report exceeds the 20 MB limit');
  }
  if (!response.body) throw new Error('External report body is missing');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REPORT_BYTES) {
      await reader.cancel();
      throw new Error('External report exceeds the 20 MB limit');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (Buffer.from(bytes.subarray(0, 5)).toString('ascii') !== '%PDF-') {
    throw new Error('External report has an invalid PDF signature');
  }
  return bytes;
}

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const externalRunId = new URL(req.url).searchParams.get('externalRunId');
  if (!externalRunId || !/^[A-Za-z0-9_-]{1,128}$/.test(externalRunId)) {
    return NextResponse.json({ error: 'A valid externalRunId is required' }, { status: 400 });
  }

  const [run] = await db.select({ id: externalAgenticRuns.id })
    .from(externalAgenticRuns)
    .where(and(
      eq(externalAgenticRuns.externalRunId, externalRunId),
      eq(externalAgenticRuns.ownerId, session.auth.userId)
    ))
    .limit(1);
  if (!run) return NextResponse.json({ error: 'External run not found' }, { status: 404 });

  try {
    const remote = await fetchExternalAgenticReport(externalRunId);
    const report = await readReport(remote);
    const body = report.buffer.slice(report.byteOffset, report.byteOffset + report.byteLength) as ArrayBuffer;
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="analysis-${externalRunId}.pdf"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
