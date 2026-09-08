'use client';

import { useEffect, useState } from 'react';

interface HistoryItem { title: string; status: string; requestedAt: string; completedAt: string | null; detail: string; }
interface HistoryFolder { key: string; title: string; description: string; items: HistoryItem[]; }

export default function ResearchHistoryPage() {
  const [folders, setFolders] = useState<HistoryFolder[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/research-history', { signal: controller.signal }).then(async (response) => {
      const body = await response.json() as { folders?: HistoryFolder[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Research history could not be loaded.');
      setFolders(body.folders ?? []);
    }).catch((cause) => { if (!controller.signal.aborted) setError((cause as Error).message); });
    return () => controller.abort();
  }, []);
  return <main>
    <h1>Research history</h1>
    <p className="sub">A single organized record of work completed by the framework. Technical run IDs are intentionally hidden.</p>
    {error && <p className="login-error" role="alert">{error}</p>}
    <div className="history-folders">{folders.map((folder) => <section className="card history-folder" key={folder.key}>
      <h2>{folder.title}</h2><p className="note">{folder.description}</p>
      {folder.items.length === 0 ? <p className="note">No activity recorded yet.</p> : <details><summary>{folder.items.length} recorded item{folder.items.length === 1 ? '' : 's'}</summary>
        <ul className="history-list">{folder.items.map((item, index) => <li key={`${item.title}-${item.requestedAt}-${index}`}><strong>{item.title}</strong><span className={`badge ${item.status === 'failed' ? 'breach' : item.status === 'completed' || item.status === 'confirmed' || item.status === 'imported' ? 'ok' : 'watch'}`}>{item.status}</span><p>{item.detail}</p><small>Started {new Date(item.requestedAt).toLocaleString()}{item.completedAt ? ` · completed ${new Date(item.completedAt).toLocaleString()}` : ''}</small></li>)}</ul>
      </details>}
    </section>)}</div>
  </main>;
}
