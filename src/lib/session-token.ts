const encoder = new TextEncoder();
export const SESSION_COOKIE = 'portfolio_session';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

export async function signSessionPayload(payload: string, secret: string): Promise<string> {
  return `${payload}.${await hmac(payload, secret)}`;
}

export async function verifySessionToken(
  token: string,
  secret: string
): Promise<{ sessionId: string; expiresAt: Date; payload: string } | null> {
  if (token.length > 512) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [sessionId, expiryValue, nonce, signature] = parts;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId) ||
    !/^\d{13}$/.test(expiryValue) ||
    !/^[A-Za-z0-9_-]{43}$/.test(nonce) ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature)
  ) return null;
  const payload = `${sessionId}.${expiryValue}.${nonce}`;
  const expected = await hmac(payload, secret);
  if (!constantTimeEqual(signature, expected)) return null;

  const expiresAt = new Date(Number(expiryValue));
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) return null;
  return { sessionId, expiresAt, payload };
}

export async function digestSessionPayload(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(payload));
  return toBase64Url(new Uint8Array(digest));
}
