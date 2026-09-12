'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCopilotReadable, useCopilotAction } from '@copilotkit/react-core';
import {
  fetchTasks, fetchDeliverables, configured,
  taskId, taskTitle, taskStatus, taskWorker, taskSource, taskTime,
  delvTaskId, delvName, delvUrl, delvKind, STATUS_COLOR, type Row,
} from '@/lib/crew';

const POLL_MS = 3000;

export default function Board() {
  const [tasks, setTasks] = useState<Row[]>([]);
  const [delvs, setDelvs] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [t, d] = await Promise.all([fetchTasks(), fetchDeliverables()]);
        if (!alive) return;
        setTasks(t); setDelvs(d); setError(null);
      } catch (e: any) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoaded(true);
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const byTask = useMemo(() => {
    const m: Record<string, Row[]> = {};
    for (const d of delvs) (m[delvTaskId(d)] ||= []).push(d);
    return m;
  }, [delvs]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of tasks) c[taskStatus(t)] = (c[taskStatus(t)] ?? 0) + 1;
    return c;
  }, [tasks]);

  // This is what makes the copilot useful rather than decorative: it can see the live board.
  useCopilotReadable({
    description: 'Live Crewboard state: every task, its status, the worker that claimed it, and its deliverables.',
    value: tasks.map(t => ({
      id: taskId(t),
      title: taskTitle(t),
      status: taskStatus(t),
      worker: taskWorker(t) || 'unclaimed',
      capturedFrom: taskSource(t) || 'unknown',
      createdAt: taskTime(t),
      deliverables: (byTask[taskId(t)] ?? []).map(d => ({ name: delvName(d), kind: delvKind(d), url: delvUrl(d) })),
    })),
  });

  // Generative UI: the copilot renders a real card in the chat instead of a paragraph of text.
  useCopilotAction({
    name: 'highlightTask',
    description: 'Show a single task as a card in the chat. Use when the user asks about one specific task.',
    parameters: [{ name: 'id', type: 'string', description: 'The task id' }],
    handler: async () => 'shown',
    render: ({ args }) => {
      const t = tasks.find(x => taskId(x) === String(args.id));
      if (!t) return <div className="text-xs text-zinc-500">No task {String(args.id)}</div>;
      return <TaskCard t={t} delvs={byTask[taskId(t)] ?? []} compact />;
    },
  });

  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Crewboard</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Intent captured at the cursor. A crew of agents executes it. Results land where the team works.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          {Object.entries(counts).map(([s, n]) => (
            <span key={s} className={`rounded-full border px-2.5 py-1 ${STATUS_COLOR[s] ?? STATUS_COLOR.unknown}`}>
              {n} {s}
            </span>
          ))}
          <span className="text-zinc-600">· refreshing every {POLL_MS / 1000}s</span>
        </div>
      </header>

      {!configured && <Note>Set <code>.env.local</code> from <code>.env.local.example</code>, then restart <code>npm run dev</code>.</Note>}
      {error && <Note tone="bad">Supabase: {error}</Note>}
      {loaded && !error && tasks.length === 0 && <Note>No tasks yet. Fire one from the capture client and it appears here within {POLL_MS / 1000}s.</Note>}

      <ul className="space-y-3">
        {tasks.map(t => <li key={taskId(t)}><TaskCard t={t} delvs={byTask[taskId(t)] ?? []} /></li>)}
      </ul>
    </main>
  );
}

function TaskCard({ t, delvs, compact }: { t: Row; delvs: Row[]; compact?: boolean }) {
  const status = taskStatus(t);
  return (
    <div className={`rounded-xl border border-zinc-800 bg-zinc-900/60 ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-start gap-3">
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_COLOR[status] ?? STATUS_COLOR.unknown}`}>
          {status}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-100">{taskTitle(t)}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {taskWorker(t) ? <>claimed by <span className="text-zinc-300">{taskWorker(t)}</span></> : 'unclaimed'}
            {taskSource(t) && <> · captured in {taskSource(t)}</>}
            {taskTime(t) && <> · {new Date(taskTime(t)).toLocaleTimeString()}</>}
          </p>
          {delvs.length > 0 && (
            <ul className="mt-2 space-y-1">
              {delvs.map((d, i) => (
                <li key={i} className="text-xs">
                  <span className="text-emerald-400">✓</span>{' '}
                  {delvUrl(d)
                    ? <a href={delvUrl(d)} target="_blank" rel="noreferrer" className="text-sky-400 underline underline-offset-2">{delvName(d)}</a>
                    : <span className="text-zinc-300">{delvName(d)}</span>}
                  <span className="ml-1.5 text-zinc-600">{delvKind(d)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Note({ children, tone }: { children: React.ReactNode; tone?: 'bad' }) {
  return (
    <div className={`mb-5 rounded-lg border px-4 py-3 text-sm ${
      tone === 'bad' ? 'border-rose-500/40 bg-rose-500/10 text-rose-200' : 'border-zinc-800 bg-zinc-900/60 text-zinc-400'}`}>
      {children}
    </div>
  );
}
