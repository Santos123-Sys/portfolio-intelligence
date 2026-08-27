export type JsonRequestResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413 | 415; error: string };

/** Reads JSON incrementally so schema validation is not preceded by an unbounded allocation. */
export async function readBoundedJson(req: Request, maxBytes = 64 * 1024): Promise<JsonRequestResult> {
  const contentType = req.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return { ok: false, status: 415, error: 'Content-Type must be application/json' };
  }
  const declaredLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, status: 413, error: 'Request body is too large' };
  }
  if (!req.body) return { ok: false, status: 400, error: 'Request body is required' };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, status: 413, error: 'Request body is too large' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: 'Request body could not be read' };
  }

  try {
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(source) };
  } catch {
    return { ok: false, status: 400, error: 'Request body must contain valid JSON' };
  }
}
