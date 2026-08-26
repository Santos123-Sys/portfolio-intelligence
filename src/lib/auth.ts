import { getEnv } from './env';

export interface AuthContext {
  subject: string;
  mode: 'api-key' | 'development';
}

function bearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (!auth?.toLowerCase().startsWith('bearer ')) return null;
  return auth.slice('bearer '.length).trim();
}

/**
 * Temporary mutation guard.
 *
 * This is intentionally narrower than full authentication: read-only dashboard
 * APIs remain public for the preview, while thesis/candidate mutations require a
 * secret. Replace this with user/session auth before using real portfolio data.
 */
export function assertMutationAuthorized(req: Request): AuthContext {
  const env = getEnv();
  const expected = env.MUTATION_API_KEY;

  if (!expected) {
    if (env.NODE_ENV === 'production') {
      throw new Error('MUTATION_API_KEY is required in production for write APIs');
    }
    return { subject: req.headers.get('x-actor') ?? 'development', mode: 'development' };
  }

  const supplied = req.headers.get('x-api-key') ?? bearerToken(req);
  if (supplied !== expected) throw new Error('Unauthorized mutation request');

  return { subject: req.headers.get('x-actor') ?? 'api-key-user', mode: 'api-key' };
}
