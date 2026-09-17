'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: data.get('displayName'),
          email: data.get('email'),
          password: data.get('password'),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? 'Unable to create the account');
        return;
      }
      router.replace('/how-it-works');
      router.refresh();
    } catch {
      setError('Unable to reach the registration service');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <p className="login-eyebrow">Client investment workspace</p>
        <h1>Create your account</h1>
        <p className="sub">Your portfolio, thesis, research, and decisions remain separate from every other client account.</p>
        <form onSubmit={submit} className="login-form">
          <label>
            Name
            <input name="displayName" type="text" autoComplete="name" minLength={2} maxLength={100} required />
          </label>
          <label>
            Email
            <input name="email" type="email" autoComplete="email" maxLength={254} required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="new-password" minLength={15} maxLength={128} required />
          </label>
          <p className="login-help">Use a unique passphrase with at least 15 characters.</p>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p className="login-help">Already have access? <Link href="/login">Sign in</Link></p>
      </section>
    </main>
  );
}
