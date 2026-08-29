'use client';

import { useCallback, useEffect, useState } from 'react';

interface AgentConfig {
  agentKind: string;
  configVersion: number;
  name: string;
  scope: string;
  promptAddendum: string;
  enabledTools: string[];
  allowedTools: string[];
  reasoningPromptVersion: number;
  reasoningPrompt: {
    sourceFile: string | null;
    adaptationNote: string;
    systemPrompt: string;
  };
}

interface EnginePolicy {
  engineKind: string;
  name: string;
  sourceFile: string;
  implementationNote: string;
  scope: string;
  policy: string;
}

export default function AgentSettingsPage() {
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [policy, setPolicy] = useState('');
  const [enginePolicies, setEnginePolicies] = useState<EnginePolicy[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/agent-configs');
    const body = await response.json().catch(() => ({})) as {
      configurations?: AgentConfig[];
      immutablePolicy?: string;
      deterministicEnginePolicies?: EnginePolicy[];
      error?: string;
    };
    if (!response.ok) throw new Error(body.error ?? `Agent settings failed (${response.status})`);
    setConfigs(body.configurations ?? []);
    setPolicy(body.immutablePolicy ?? '');
    setEnginePolicies(body.deterministicEnginePolicies ?? []);
  }, []);

  useEffect(() => {
    void load().catch((cause) => setMessage((cause as Error).message));
  }, [load]);

  function update(kind: string, patch: Partial<AgentConfig>) {
    setConfigs((current) => current.map((config) => config.agentKind === kind ? { ...config, ...patch } : config));
  }

  async function save(config: AgentConfig) {
    setBusy(config.agentKind);
    setMessage(null);
    try {
      const response = await fetch('/api/agent-configs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentKind: config.agentKind,
          name: config.name,
          scope: config.scope,
          promptAddendum: config.promptAddendum,
          enabledTools: config.enabledTools,
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Save failed (${response.status})`);
      await load();
      setMessage(`${config.name} saved as a new immutable version.`);
    } catch (cause) {
      setMessage((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <main>
      <h1>Agent Settings</h1>
      <p className="sub">Review each protected reasoning prompt, then personalize the lower-priority role, scope, addendum and approved tools. Every save creates a new owner-configuration version.</p>
      <section className="card policy-card">
        <h2>Protected system policy</h2>
        <p>{policy || 'Loading protected policy…'}</p>
        <p className="note">These controls cannot enable trading, direct dashboard-database access, ungrounded facts, or LLM arithmetic.</p>
      </section>
      {message && <p className={message.includes('saved') ? 'security-message' : 'security-message error'} role="status">{message}</p>}
      <div className="agent-config-list">{configs.map((config) => (
        <section className="card agent-config-card" key={config.agentKind}>
          <div className="candidate-heading">
            <div><h2>{config.name}</h2><p className="note">{config.agentKind} · active version {config.configVersion}</p></div>
          </div>
          <details className="reasoning-policy">
            <summary>Protected system reasoning prompt · version {config.reasoningPromptVersion}</summary>
            <p className="note">
              {config.reasoningPrompt.sourceFile ? `Adapted from ${config.reasoningPrompt.sourceFile}. ` : ''}
              {config.reasoningPrompt.adaptationNote}
            </p>
            <textarea
              aria-label={`${config.name} protected system reasoning prompt`}
              value={config.reasoningPrompt.systemPrompt}
              readOnly
              rows={14}
            />
          </details>
          <div className="setup-form">
            <label>Display name
              <input value={config.name} maxLength={120} onChange={(event) => update(config.agentKind, { name: event.target.value })} />
            </label>
            <label>Scope
              <textarea value={config.scope} maxLength={2000} onChange={(event) => update(config.agentKind, { scope: event.target.value })} />
            </label>
            <label>Prompt addendum
              <textarea value={config.promptAddendum} maxLength={4000} placeholder="Add preferences, source priorities, or analytical emphasis. Protected rules remain higher priority." onChange={(event) => update(config.agentKind, { promptAddendum: event.target.value })} />
            </label>
            <fieldset className="tool-picker">
              <legend>Tools</legend>
              {config.allowedTools.map((tool) => <label key={tool}>
                <input
                  type="checkbox"
                  checked={config.enabledTools.includes(tool)}
                  disabled={tool !== 'web_search'}
                  onChange={(event) => update(config.agentKind, {
                    enabledTools: event.target.checked
                      ? [...config.enabledTools, tool]
                      : config.enabledTools.filter((item) => item !== tool),
                  })}
                /> {tool}{tool !== 'web_search' ? ' (required)' : ' (optional)'}
              </label>)}
            </fieldset>
            <button type="button" onClick={() => void save(config)} disabled={busy !== null}>
              {busy === config.agentKind ? 'Saving version…' : 'Save new version'}
            </button>
          </div>
        </section>
      ))}</div>
      <section className="card engine-policy-section">
        <h2>Deterministic engine policies</h2>
        <p className="note">The attached DCF and risk instructions govern code-backed engines. They are visible here for auditability but are never sent to an LLM or editable as agent prompts.</p>
        <div className="agent-config-list">{enginePolicies.map((engine) => (
          <details className="reasoning-policy" key={engine.engineKind}>
            <summary>{engine.name}</summary>
            <p>{engine.scope}</p>
            <p className="note">Adapted from {engine.sourceFile}. {engine.implementationNote}</p>
            <textarea aria-label={`${engine.name} protected policy`} value={engine.policy} readOnly rows={8} />
          </details>
        ))}</div>
      </section>
    </main>
  );
}
