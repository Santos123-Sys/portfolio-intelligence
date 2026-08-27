import { describe, expect, it } from 'vitest';
import {
  MAX_TEXT_BYTES,
  validateThesisDocument,
} from '../src/lib/document-security';
import { readBoundedJson } from '../src/lib/request-body';
import { safeLocalReturnPath, validateMutationOrigin } from '../src/lib/request-security';

function encoded(value: string | Buffer): string {
  return Buffer.from(value).toString('base64');
}

describe('thesis document security boundary', () => {
  it('accepts a passive PDF with a valid signature and trailer', () => {
    const result = validateThesisDocument({
      fileName: 'investment-thesis.pdf',
      mimeType: 'application/pdf',
      contentBase64: encoded('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n'),
    });
    expect(result.byteLength).toBeGreaterThan(20);
    expect(result.fileName).toBe('investment-thesis.pdf');
  });

  it('rejects mislabeled, incomplete and active-content PDFs', () => {
    expect(() => validateThesisDocument({
      fileName: 'fake.pdf',
      mimeType: 'application/pdf',
      contentBase64: encoded('not a pdf'),
    })).toThrow(/signature/);
    expect(() => validateThesisDocument({
      fileName: 'active.pdf',
      mimeType: 'application/pdf',
      contentBase64: encoded('%PDF-1.4\n/OpenAction 1 0 R\n%%EOF'),
    })).toThrow(/active or embedded/);
  });

  it('rejects path-like names, malformed base64 and non-UTF-8 text', () => {
    expect(() => validateThesisDocument({
      fileName: '../thesis.txt',
      mimeType: 'text/plain',
      contentBase64: encoded('criteria'),
    })).toThrow(/filename/);
    expect(() => validateThesisDocument({
      fileName: 'thesis.txt',
      mimeType: 'text/plain',
      contentBase64: 'not-base64!',
    })).toThrow(/encoding/);
    expect(() => validateThesisDocument({
      fileName: 'thesis.txt',
      mimeType: 'text/plain',
      contentBase64: Buffer.from([0xff, 0xfe]).toString('base64'),
    })).toThrow(/UTF-8/);
  });

  it('enforces the smaller text-document limit before external handoff', () => {
    expect(() => validateThesisDocument({
      fileName: 'large.md',
      mimeType: 'text/markdown',
      contentBase64: Buffer.alloc(MAX_TEXT_BYTES + 1, 0x61).toString('base64'),
    })).toThrow(/2 MB/);
  });
});

describe('bounded JSON parsing', () => {
  it('accepts valid JSON with the required media type', async () => {
    const result = await readBoundedJson(new Request('https://example.test/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ value: 'safe' }),
    }), 256);
    expect(result).toEqual({ ok: true, value: { value: 'safe' } });
  });

  it('rejects unsupported media types and streamed bodies over the limit', async () => {
    const wrongType = await readBoundedJson(new Request('https://example.test/api', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    }), 256);
    expect(wrongType).toMatchObject({ ok: false, status: 415 });

    const tooLarge = await readBoundedJson(new Request('https://example.test/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(300) }),
    }), 128);
    expect(tooLarge).toMatchObject({ ok: false, status: 413 });
  });
});

describe('cross-site mutation protection', () => {
  const options = { production: true, publicAppUrl: 'https://portfolio.example.com' };

  it('accepts the configured origin and same-origin Fetch Metadata', () => {
    expect(() => validateMutationOrigin(new Request('http://dashboard.internal/api/auth/session', {
      method: 'POST',
      headers: {
        origin: 'https://portfolio.example.com',
        'sec-fetch-site': 'same-origin',
        'x-forwarded-host': 'portfolio.example.com',
        'x-forwarded-proto': 'https',
      },
    }), options)).not.toThrow();
  });

  it('rejects cross-site metadata, mismatched origins and missing production evidence', () => {
    expect(() => validateMutationOrigin(new Request('https://portfolio.example.com/api', {
      method: 'POST',
      headers: { origin: 'https://portfolio.example.com', 'sec-fetch-site': 'cross-site' },
    }), options)).toThrow(/Cross-origin/);
    expect(() => validateMutationOrigin(new Request('https://portfolio.example.com/api', {
      method: 'POST',
      headers: { origin: 'https://attacker.example' },
    }), options)).toThrow(/Cross-origin/);
    expect(() => validateMutationOrigin(new Request('https://portfolio.example.com/api', {
      method: 'POST',
    }), options)).toThrow(/origin is required/);
  });

  it('allows local post-login paths and rejects scheme-relative or backslash redirects', () => {
    const origin = 'https://portfolio.example.com';
    expect(safeLocalReturnPath('/risk?portfolio=1', origin)).toBe('/risk?portfolio=1');
    expect(safeLocalReturnPath('//attacker.example/path', origin)).toBe('/');
    expect(safeLocalReturnPath('/\\attacker.example/path', origin)).toBe('/');
    expect(safeLocalReturnPath('https://attacker.example/path', origin)).toBe('/');
  });
});
