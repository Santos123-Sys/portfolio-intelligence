'use client';

import { FormEvent, useEffect, useState } from 'react';

interface MfaStatus {
  enabled: boolean;
  setupPending: boolean;
  recoveryCodesRemaining: number;
  enrollmentAvailable: boolean;
}

interface Enrollment {
  secret: string;
  enrollmentUri: string;
}

async function responseBody(response: Response): Promise<{ error?: string; [key: string]: unknown }> {
  return response.json().catch(() => ({}));
}

export default function AccountSecurityPage() {
  const [mfa, setMfa] = useState<MfaStatus | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refreshMfa(signal?: AbortSignal) {
    const response = await fetch('/api/auth/mfa', { signal, cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to load account security settings');
    setMfa(await response.json() as MfaStatus);
  }

  useEffect(() => {
    const controller = new AbortController();
    void refreshMfa(controller.signal).catch(() => {
      if (!controller.signal.aborted) setError('Unable to load account security settings');
    });
    return () => controller.abort();
  }, []);

  function beginAction() {
    setBusy(true);
    setError(null);
    setMessage(null);
  }

  async function beginMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    beginAction();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetch('/api/auth/mfa', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: data.get('currentPassword') }),
      });
      const body = await responseBody(response);
      if (!response.ok) setError(body.error ?? 'Unable to start MFA setup');
      else {
        setEnrollment({ secret: String(body.secret), enrollmentUri: String(body.enrollmentUri) });
        setMessage('Add the key to your authenticator, then confirm the current code.');
        form.reset();
      }
    } catch {
      setError('Unable to reach the security service');
    } finally {
      setBusy(false);
    }
  }

  async function confirmMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    beginAction();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetch('/api/auth/mfa', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: data.get('currentPassword'), code: data.get('code') }),
      });
      const body = await responseBody(response);
      if (!response.ok) setError(body.error ?? 'Unable to confirm MFA');
      else {
        setRecoveryCodes(Array.isArray(body.recoveryCodes) ? body.recoveryCodes.map(String) : []);
        setEnrollment(null);
        setMessage('Multi-factor authentication is enabled. Save the recovery codes now.');
        form.reset();
        await refreshMfa();
      }
    } catch {
      setError('Unable to reach the security service');
    } finally {
      setBusy(false);
    }
  }

  async function disableMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    beginAction();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetch('/api/auth/mfa', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: data.get('currentPassword'), code: data.get('code') }),
      });
      const body = await responseBody(response);
      if (!response.ok) setError(body.error ?? 'Unable to disable MFA');
      else {
        setRecoveryCodes([]);
        setMessage('Multi-factor authentication is disabled. Other sessions were revoked.');
        form.reset();
        await refreshMfa();
      }
    } catch {
      setError('Unable to reach the security service');
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    beginAction();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (data.get('newPassword') !== data.get('confirmPassword')) {
      setError('New-password confirmation does not match');
      setBusy(false);
      return;
    }
    try {
      const response = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          currentPassword: data.get('currentPassword'),
          newPassword: data.get('newPassword'),
          mfaCode: data.get('mfaCode') || undefined,
        }),
      });
      const body = await responseBody(response);
      if (!response.ok) setError(body.error ?? 'Unable to change password');
      else {
        setMessage('Password changed. Other browser sessions were revoked.');
        form.reset();
      }
    } catch {
      setError('Unable to reach the security service');
    } finally {
      setBusy(false);
    }
  }

  async function copyRecoveryCodes() {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setMessage('Recovery codes copied. Store them somewhere private and offline.');
    } catch {
      setError('Clipboard access was denied. Copy each recovery code manually.');
    }
  }

  return (
    <main>
      <h1>Account Security</h1>
      <p className="sub">Manage your password, authenticator and recovery access.</p>

      {(message || error) && (
        <p className={error ? 'security-message error' : 'security-message'} role={error ? 'alert' : 'status'}>
          {error ?? message}
        </p>
      )}

      <div className="security-grid">
        <section className="card security-card">
          <h2>Password</h2>
          <p className="note">Use a unique passphrase of at least 15 characters. Changing it revokes every other session.</p>
          <form className="security-form" onSubmit={changePassword}>
            <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required /></label>
            <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={15} maxLength={128} required /></label>
            <label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={15} maxLength={128} required /></label>
            {mfa?.enabled && <label>Verification or recovery code<input name="mfaCode" type="text" autoComplete="one-time-code" maxLength={64} required /></label>}
            <button type="submit" disabled={busy}>Change password</button>
          </form>
        </section>

        <section className="card security-card">
          <h2>Multi-factor authentication</h2>
          {!mfa && <p className="note">Loading security status…</p>}
          {mfa && !mfa.enrollmentAvailable && <p className="caveat">Set MFA_ENCRYPTION_KEY on Railway before enrolling an authenticator.</p>}
          {mfa?.enabled ? (
            <>
              <p className="security-state">Enabled · {mfa.recoveryCodesRemaining} recovery codes remaining</p>
              <form className="security-form" onSubmit={disableMfa}>
                <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required /></label>
                <label>Verification or recovery code<input name="code" type="text" autoComplete="one-time-code" maxLength={64} required /></label>
                <button type="submit" className="danger-button" disabled={busy}>Disable MFA</button>
              </form>
            </>
          ) : enrollment ? (
            <>
              <p className="note">In your authenticator app, choose “enter setup key” and use:</p>
              <code className="secret-key">{enrollment.secret}</code>
              <details><summary>Authenticator URI</summary><code className="uri-value">{enrollment.enrollmentUri}</code></details>
              <form className="security-form" onSubmit={confirmMfa}>
                <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required /></label>
                <label>Six-digit code<input name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label>
                <button type="submit" disabled={busy}>Confirm and enable MFA</button>
              </form>
            </>
          ) : (
            <form className="security-form" onSubmit={beginMfa}>
              <p className="note">An authenticator code will be required after your password at every sign-in.</p>
              <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required /></label>
              <button type="submit" disabled={busy || !mfa?.enrollmentAvailable}>Set up authenticator</button>
            </form>
          )}
        </section>
      </div>

      {recoveryCodes.length > 0 && (
        <section className="card recovery-card" aria-labelledby="recovery-heading">
          <h2 id="recovery-heading">One-time recovery codes</h2>
          <p className="caveat">These codes will not be shown again. Each works once.</p>
          <ul className="recovery-codes">{recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
          <button type="button" className="action-button" onClick={copyRecoveryCodes}>Copy recovery codes</button>
        </section>
      )}
    </main>
  );
}
