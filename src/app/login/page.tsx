'use client';

import { FormEvent, useState } from 'react';

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    const response = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? 'Unable to sign in');
      setSubmitting(false);
      return;
    }
    const requested = new URLSearchParams(window.location.search).get('returnTo');
    const destination = requested?.startsWith('/') && !requested.startsWith('//') ? requested : '/';
    window.location.assign(destination);
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
            <input name="password" type="password" autoComplete="current-password" minLength={12} required />
          </label>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
