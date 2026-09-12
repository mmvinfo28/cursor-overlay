// Server-side half of the Ambiguous bridge (runs on Vercel, cron every minute; no local secrets needed).
//   deliver: a task turned `done`        → Doc + message in the creator's own Ambiguous workspace (their coworker key)
//   ask:     a task turned `needs-human` → the question in a per-task thread there
// State is kept on the task row itself (tasks.result.ambiguous / events) so runs are idempotent.
// The local backend/ambiguous.mjs still adds @mention conversation for the team workspace.

const BASE = (process.env.AMBIGUOUS_BASE || 'https://app.ambiguous.ai').replace(/\/$/, '');
const CHANNEL = process.env.AMBIGUOUS_CHANNEL || 'crewboard';

async function ambi(key, method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`ambiguous ${method} ${path} ${r.status} ${text.slice(0, 160)}`);
  try { return JSON.parse(text); } catch { return {}; }
}
const list = (x) => Array.isArray(x) ? x : (x?.data ?? x?.items ?? x?.channels ?? x?.messages ?? []);

const channelCache = new Map();
async function channelFor(key, request) {
  if (channelCache.has(key)) return channelCache.get(key);
  const chans = list(await request(key, 'GET', '/api/channels'));
  let id = chans.find((c) => (c.name || '').replace(/^#/, '').toLowerCase() === CHANNEL)?.id;
  if (!id) { const made = await request(key, 'POST', '/api/channels', { name: CHANNEL, type: 'public', description: 'Crewboard — tasks, questions and results from the crew' }); id = made.id || made.data?.id; }
  if (!id) throw new Error('Ambiguous returned no channel ID');
  channelCache.set(key, id);
  return id;
}
const say = async (key, content, thread_key, request) => request(key, 'POST', `/api/channels/${await channelFor(key, request)}/messages`, { content, thread_key });
function checked(result) { if (result.error) throw new Error(result.error.message); return result.data; }

// the coworker key of whoever created the task (profiles.email → profile_secrets), else the team key
async function keyFor(db, createdBy) {
  if (createdBy) {
    const prof = checked(await db.from('profiles').select('user_id').eq('email', createdBy).maybeSingle());
    if (prof) {
      const sec = checked(await db.from('profile_secrets').select('ambiguous_agent_key').eq('user_id', prof.user_id).maybeSingle());
      if (sec?.ambiguous_agent_key) return sec.ambiguous_agent_key;
    }
  }
  return process.env.AMBIGUOUS_API_KEY || null;
}

export async function bridgeTick(db, { request = ambi } = {}) {
  const out = { delivered: [], asked: [], skipped: 0, errors: [] };

  // 1. deliver — done tasks not yet marked result.ambiguous
  const done = checked(await db.from('tasks').select('id,title,source_app,result,created_by,worker:workers(name),deliverables(kind,name,url,body)')
    .eq('status', 'done').or('result->ambiguous.is.null,result->ambiguous->>skipped.not.is.null,result->ambiguous->at.is.null').order('updated_at', { ascending: true }).limit(10));
  for (const t of done || []) {
    try {
      const key = await keyFor(db, t.created_by);
      // Keep unprovisioned users eligible: their first dashboard sign-in can happen later.
      if (!key) { out.skipped++; continue; }
      const files = [...(t.deliverables || []).filter((d) => d.kind !== 'text')];
      for (const file of t.result?.files || []) if (!files.some(f => f.url === file.url)) files.push(file);
      const summary = (t.deliverables || []).find((d) => d.kind === 'text')?.body || t.result?.summary || 'Done.';
      const md = [`# ${t.title}`, '', summary, '', files.length ? '## Files' : '', ...files.map((f) => `- [${f.name}](${f.url})`), '', `_Delivered by ${t.worker?.name || 'the crew'} via Crewboard · source: ${t.source_app || '—'}_`].join('\n');
      let docUrl = t.result?.ambiguous?.doc;
      if (!docUrl) {
        const doc = await request(key, 'POST', '/api/documents', { type: 'doc', title: t.title, content: md, visibility: 'workspace' });
        docUrl = doc.url || (doc.id ? `${BASE}/docs/${doc.id}` : null);
        if (!docUrl) throw new Error('Ambiguous returned no document URL or ID');
        checked(await db.from('tasks').update({ result: { ...(t.result || {}), ambiguous: { doc: docUrl } } }).eq('id', t.id));
      }
      await say(key, `✓ **${t.title}** — done by ${t.worker?.name || 'the crew'}.\n${summary}${files.length ? '\n' + files.map((f) => `• ${f.name}: ${f.url}`).join('\n') : ''}\n📄 ${docUrl}`, `task-${t.id}`, request);
      checked(await db.from('tasks').update({ result: { ...(t.result || {}), ambiguous: { doc: docUrl, at: new Date().toISOString() } } }).eq('id', t.id));
      out.delivered.push(t.title);
    } catch (e) { out.errors.push(`${t.title}: ${e.message}`); }
  }

  // 2. ask — needs-human questions not yet relayed (an 'ambiguous-asked' event marks it)
  const asking = checked(await db.from('tasks').select('id,title,created_by,events(id,kind,payload,at)').eq('status', 'needs-human').limit(20));
  for (const t of asking || []) {
    const evs = (t.events || []).slice().sort((a, b) => (a.at < b.at ? -1 : 1));
    const q = evs.filter((e) => e.kind === 'needs-human').pop();
    if (!q) continue;
    if (evs.some((e) => e.kind === 'ambiguous-asked' && e.payload?.event === q.id)) continue;
    try {
      const key = await keyFor(db, t.created_by);
      if (!key) continue;
      await say(key, `❓ **${t.title}** — the crew needs you: ${q.payload?.question || 'your input'}\n_Reply on the Crewboard board (or in the panel) to answer._`, `task-${t.id}`, request);
      checked(await db.from('events').insert({ task_id: t.id, kind: 'ambiguous-asked', payload: { event: q.id } }));
      out.asked.push(t.title);
    } catch (e) { out.errors.push(`${t.title}: ${e.message}`); }
  }
  return out;
}
