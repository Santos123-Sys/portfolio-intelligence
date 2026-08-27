'use client';

import { FormEvent, useState } from 'react';
import { safeLocalReturnPath } from '@/lib/request-security';

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: data.get('email'),
          password: data.get('password'),
          mfaCode: mfaRequired ? data.get('mfaCode') : undefined,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; mfaRequired?: boolean };
      if (response.status === 202 && body.mfaRequired) {
        setMfaRequired(true);
        return;
      }
      if (!response.ok) {
        setError(body.error ?? 'Unable to sign in');
        return;
      }
      const requested = new URLSearchParams(window.location.search).get('returnTo');
      const destination = safeLocalReturnPath(requested, window.location.origin);
      window.location.assign(destination);
    } catch {
      setError('Unable to reach the sign-in service');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <p className="login-eyebrow">Private investment workspace</p>
        <h1>Portfolio Intelligence</h1>
        <p className="sub">Sign in to access portfolio data, analysis history and agentic-system runs.</p>
        <form onSubmit={submit} className="login-form">
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" maxLength={128} required />
          </label>
          {mfaRequired && (
            <label>
              Verification or recovery code
              <input
                name="mfaCode"
                type="text"
                autoComplete="one-time-code"
                maxLength={64}
                autoFocus
                required
              />
            </label>
          )}
          {mfaRequired && <p className="login-help">Enter the six-digit code from your authenticator app, or one unused recovery code.</p>}
          {error && <p className="login-error" role="alert">{error}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Verifying…' : mfaRequired ? 'Verify and sign in' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
