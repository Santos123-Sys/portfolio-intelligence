export function validateMutationOrigin(
  req: Request,
  options: { production: boolean; publicAppUrl?: string }
): void {
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new Error('Cross-origin mutation rejected');
  }
  const origin = req.headers.get('origin');
  if (!origin) {
    if (options.production && fetchSite !== 'same-origin') throw new Error('Mutation origin is required');
    return;
  }

  let suppliedOrigin: string;
  try {
    suppliedOrigin = new URL(origin).origin;
  } catch {
    throw new Error('Mutation origin is invalid');
  }

  const configuredOrigin = options.publicAppUrl ? new URL(options.publicAppUrl).origin : null;
  const expectedHost = (req.headers.get('x-forwarded-host') ?? req.headers.get('host'))
    ?.split(',')[0]
    .trim();
  const expectedProtocol = (req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', ''))
    .split(',')[0]
    .trim();
  const expectedOrigin = configuredOrigin ?? (expectedHost ? `${expectedProtocol}://${expectedHost}` : null);
  if (!expectedOrigin || suppliedOrigin !== expectedOrigin) throw new Error('Cross-origin mutation rejected');
}

export function safeLocalReturnPath(value: string | null, applicationOrigin: string): string {
  if (!value?.startsWith('/')) return '/';
  try {
    const target = new URL(value, applicationOrigin);
    if (target.origin !== new URL(applicationOrigin).origin) return '/';
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return '/';
  }
}
