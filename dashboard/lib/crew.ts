// Supabase REST access, same project results.js syncs from. No client library: one fetch, anon key.
// Column names are guessed defensively - the hackathon schema is still moving, so every accessor
// falls back through the plausible names instead of hard-failing on a rename.

export type Row = Record<string, any>;

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const configured = Boolean(URL_ && KEY);

async function sb(path: string): Promise<Row[]> {
  if (!configured) throw new Error('Supabase not configured - copy .env.local.example to .env.local');
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: { apikey: KEY!, Authorization: `Bearer ${KEY!}` },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

export const fetchTasks = () => sb('tasks?select=*&order=created_at.desc&limit=50');
export const fetchDeliverables = () => sb('deliverables?select=*&order=created_at.desc&limit=100');

// --- tolerant field access: the schema may rename these, the UI should not care ---
const pick = (r: Row, keys: string[], fallback = '') => {
  for (const k of keys) if (r[k] !== undefined && r[k] !== null && r[k] !== '') return r[k];
  return fallback;
};

export const taskId     = (t: Row) => String(pick(t, ['id', 'task_id', 'uuid'], '?'));
export const taskTitle  = (t: Row) => String(pick(t, ['title', 'name', 'prompt', 'description'], '(untitled)'));
export const taskStatus = (t: Row) => String(pick(t, ['status', 'state', 'phase'], 'unknown')).toLowerCase();
export const taskWorker = (t: Row) => String(pick(t, ['worker', 'assignee', 'claimed_by', 'agent', 'owner'], ''));
export const taskSource = (t: Row) => String(pick(t, ['source_app', 'source', 'origin'], ''));
export const taskTime   = (t: Row) => String(pick(t, ['created_at', 'inserted_at', 'ts'], ''));

export const delvTaskId = (d: Row) => String(pick(d, ['task_id', 'task', 'taskId'], ''));
export const delvName   = (d: Row) => String(pick(d, ['name', 'filename', 'title'], 'deliverable'));
export const delvUrl    = (d: Row) => String(pick(d, ['url', 'link', 'href'], ''));
export const delvKind   = (d: Row) => String(pick(d, ['kind', 'type'], 'file'));

export const STATUS_COLOR: Record<string, string> = {
  done: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
  running: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
  claimed: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
  open: 'text-sky-400 border-sky-500/40 bg-sky-500/10',
  'needs-human': 'text-rose-400 border-rose-500/40 bg-rose-500/10',
  blocked: 'text-rose-400 border-rose-500/40 bg-rose-500/10',
  unknown: 'text-zinc-400 border-zinc-600/40 bg-zinc-500/10',
};
