// Crewboard ↔ Ambiguous bridge, with Qwen (or any OpenAI-compatible model) as the coworker's brain.
//   node --env-file=backend/.env.ambiguous.local backend/ambiguous.mjs
//
// What it does, every few seconds:
//   1. deliver   — a Crewboard task turns `done`  → a Doc in Ambiguous with the summary + files, and a message in the crew channel
//   2. ask       — a task turns `needs-human`     → the worker's question lands in the channel (thread per task);
//                                                   a human reply in that thread becomes the task's `human-answer`
//   3. converse  — someone @mentions the coworker  → Qwen answers with the live board as context; "do X" creates a task
// Ambiguous hosts no model: the coworker is this process. Keys: each Crewboard user has their own coworker key
// (provisioned at sign-up, stored in profile_secrets — needs SUPABASE_SERVICE_ROLE_KEY to read); tasks created by
// that user are delivered into *their* workspace. AMBIGUOUS_API_KEY is the fallback/team coworker for everything
// else. Set AMBIGUOUS_DRY=1 to log instead of posting.

import { setTimeout as delay } from 'node:timers/promises';

const env = process.env;
const need = (k) => { if (!env[k]) throw new Error(`${k} is required`); return env[k]; };
const AMBI = (env.AMBIGUOUS_BASE || 'https://app.ambiguous.ai').replace(/\/$/, '');
const AKEY = env.AMBIGUOUS_API_KEY || (env.AMBIGUOUS_DRY ? 'dry' : null);   // team/fallback key; per-user keys come from Supabase
const CHANNEL = env.AMBIGUOUS_CHANNEL || 'crewboard';
const NAME = env.COWORKER_NAME || 'Cara';
const SB = need('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
const SBKEY = env.SUPABASE_SERVICE_ROLE_KEY || need('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const LLM = (env.LLM_BASE_URL || 'https://api.aptget.nl/v1').replace(/\/$/, '');
const LLMKEY = env.LLM_API_KEY || '';
const MODEL = env.LLM_MODEL || 'qwen3.8-27b';
const API = (env.CREWBOARD_API || 'https://crewboard-web.vercel.app').replace(/\/$/, '');
const DRY = !!env.AMBIGUOUS_DRY;
const POLL_MS = Number(env.POLL_MS || 5000);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- Ambiguous REST ----------
async function ambi(method, path, body, key = AKEY) {
  if (DRY && method !== 'GET') { log('DRY', method, path, `key=${key ? key.slice(0, 6) + '…' : 'none'}`, JSON.stringify(body).slice(0, 200)); return { id: 'dry-' + Date.now(), url: `${AMBI}/dry` }; }
  if (!key) throw new Error('no Ambiguous key for this action');
  const r = await fetch(`${AMBI}${path}`, {
    method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`ambiguous ${method} ${path} ${r.status} ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}
const list = (x) => Array.isArray(x) ? x : (x?.data ?? x?.items ?? x?.channels ?? x?.messages ?? x?.results ?? []);

// one #crewboard per workspace (= per key)
const channels = new Map();
async function channel(key = AKEY) {
  if (channels.has(key)) return channels.get(key);
  if (DRY) { channels.set(key, 'dry-channel'); return 'dry-channel'; }
  const chans = list(await ambi('GET', '/api/channels', undefined, key));
  let id = chans.find((c) => (c.name || '').replace(/^#/, '').toLowerCase() === CHANNEL.toLowerCase())?.id;
  if (!id) {
    const made = await ambi('POST', '/api/channels', { name: CHANNEL, type: 'public', description: 'Crewboard — tasks, questions and results from the crew' }, key);
    id = made.id || made.data?.id; log('created channel', CHANNEL, id);
  }
  channels.set(key, id);
  return id;
}
const say = async (content, thread_key, key = AKEY) => ambi('POST', `/api/channels/${await channel(key)}/messages`, thread_key ? { content, thread_key } : { content }, key);

// which coworker delivers a task: the creator's own (by email in profiles) or the team/fallback key
const keyCache = new Map();
async function keyFor(createdBy) {
  if (!createdBy || !env.SUPABASE_SERVICE_ROLE_KEY) return AKEY;
  if (keyCache.has(createdBy)) return keyCache.get(createdBy);
  let key = AKEY;
  try {
    const prof = await sb(`profiles?email=eq.${encodeURIComponent(createdBy)}&select=user_id&limit=1`);
    if (prof?.[0]) {
      const sec = await sb(`profile_secrets?user_id=eq.${prof[0].user_id}&select=ambiguous_agent_key&limit=1`);
      if (sec?.[0]?.ambiguous_agent_key) key = sec[0].ambiguous_agent_key;
    }
  } catch (e) { log('keyFor', e.message); }
  keyCache.set(createdBy, key);
  return key;
}

// ---------- Supabase ----------
const sbh = { apikey: SBKEY, Authorization: `Bearer ${SBKEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
async function sb(path, init = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...sbh, ...(init.headers || {}) }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`supabase ${path} ${r.status} ${(await r.text()).slice(0, 160)}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

// ---------- Qwen ----------
async function ask(system, user, max_tokens = 400) {
  if (!LLMKEY) return null;
  const body = { model: MODEL, temperature: 0.3, max_tokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
  if (/qwen/i.test(MODEL)) body.chat_template_kwargs = { enable_thinking: false };
  const r = await fetch(`${LLM}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${LLMKEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`llm ${r.status}`);
  const j = await r.json();
  return (j.choices?.[0]?.message?.content || '').trim();
}

// ---------- state (survives restarts) ----------
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const STATE = env.AMBIGUOUS_STATE || 'backend/runtime/ambiguous-state.json';
let state = { delivered: [], asked: {}, mentions: [], since: new Date().toISOString() };
try { state = { ...state, ...JSON.parse(readFileSync(STATE, 'utf8')) }; } catch {}
const save = () => { try { mkdirSync('backend/runtime', { recursive: true }); writeFileSync(STATE, JSON.stringify(state)); } catch {} };

// ---------- 1. deliver ----------
async function deliver() {
  const rows = await sb(`tasks?status=eq.done&updated_at=gt.${encodeURIComponent(state.since)}&select=id,title,context,source_app,result,updated_at,created_by,worker:workers(name),deliverables(kind,name,url,body)&order=updated_at.asc&limit=20`);
  for (const t of rows || []) {
    if (state.delivered.includes(t.id)) continue;
    const key = await keyFor(t.created_by);
    if (!key) { log('skip (no key)', t.title); state.delivered.push(t.id); continue; }
    const files = (t.deliverables || []).filter((d) => d.kind !== 'text');
    const summary = (t.deliverables || []).find((d) => d.kind === 'text')?.body || t.result?.summary || 'Done.';
    const md = [`# ${t.title}`, '', summary, '', files.length ? '## Files' : '', ...files.map((f) => `- [${f.name}](${f.url})`), '', `_Delivered by ${t.worker?.name || 'the crew'} via Crewboard · source: ${t.source_app || '—'}_`].join('\n');
    let docUrl = null;
    try {
      const doc = await ambi('POST', '/api/documents', { type: 'doc', title: t.title, content: md, visibility: 'workspace' }, key);
      docUrl = doc.url || (doc.id ? `${AMBI}/docs/${doc.id}` : null);
    } catch (e) { log('doc failed', e.message); }
    await say(`✓ **${t.title}** — done by ${t.worker?.name || 'the crew'}.\n${summary}${files.length ? '\n' + files.map((f) => `• ${f.name}: ${f.url}`).join('\n') : ''}${docUrl ? `\n📄 ${docUrl}` : ''}`, `task-${t.id}`, key);
    state.delivered.push(t.id); state.delivered = state.delivered.slice(-500);
    if (t.updated_at > state.since) state.since = t.updated_at;
    save(); log('delivered', t.title);
  }
}

// ---------- 2. ask / answer ----------
async function askHumans() {
  const rows = await sb(`tasks?status=eq.needs-human&select=id,title,created_by,events(id,kind,payload,at)&limit=50`);
  for (const t of rows || []) {
    const q = (t.events || []).filter((e) => e.kind === 'needs-human').sort((a, b) => (a.at < b.at ? 1 : -1))[0];
    if (!q || state.asked[t.id]) continue;
    const key = await keyFor(t.created_by);
    if (!key) continue;
    await say(`❓ **${t.title}** — ${NAME} needs a human: ${q.payload?.question || 'your input'}\n_Reply in this thread to answer._`, `task-${t.id}`, key);
    state.asked[t.id] = { event: q.id, by: t.created_by || null }; save(); log('asked', t.title);
  }
  // replies in a task thread → human-answer (thread_key is ours, so we can find it by searching recent messages)
  if (DRY) return;
  for (const [taskId, info] of Object.entries(state.asked)) {
    const key = await keyFor(typeof info === 'object' ? info.by : null);
    if (!key) continue;
    let msgs = [];
    try { msgs = list(await ambi('GET', `/api/channels/${await channel(key)}/messages?limit=30`, undefined, key)); } catch { continue; }
    const mine = msgs.filter((m) => (m.thread_key || m.thread?.key) === `task-${taskId}`);
    const reply = mine.find((m) => !state.mentions.includes(m.id) && !(m.author?.is_agent || m.sender?.is_agent || m.is_agent) && !/needs a human/.test(m.content || ''));
    if (!reply) continue;
    await sb('events', { method: 'POST', body: JSON.stringify({ task_id: taskId, kind: 'human-answer', payload: { text: reply.content, by: reply.author?.display_name || reply.sender?.display_name || 'ambiguous' } }) });
    await say(`↩ Passed your answer to the worker.`, `task-${taskId}`, key);
    state.mentions.push(reply.id); delete state.asked[taskId]; save(); log('answered', taskId);
  }
}

// ---------- 3. converse ----------
async function converse() {
  if (DRY || !AKEY) return;
  let inbox = [];
  try { inbox = list(await ambi('GET', '/api/channels/mentions-inbox?limit=10')); } catch (e) { return log('inbox', e.message); }
  for (const m of inbox) {
    const id = m.id || m.message_id; if (!id || state.mentions.includes(id)) continue;
    const text = (m.content || m.text || '').replace(/@\S+/g, '').trim();
    const board = await sb(`tasks?select=title,status,worker:workers(name),created_at&order=created_at.desc&limit=25`);
    const system = `You are ${NAME}, an AI coworker on the Crewboard crew, talking in the team's Ambiguous workspace. Be brief and concrete. ` +
      `If the message asks you to do a piece of work (make, draft, compare, research, summarize…), answer with exactly {"task":"<imperative title, max 10 words>","context":"<what to do, one paragraph>"} as JSON and nothing else. ` +
      `Otherwise answer in plain text using the board below.\n\nBoard:\n${(board || []).map((t) => `- [${t.status}] ${t.title}${t.worker ? ' · ' + t.worker.name : ''}`).join('\n') || '(empty)'}`;
    let reply = 'I could not reach the model.';
    try { reply = (await ask(system, text)) || reply; } catch (e) { log('llm', e.message); }
    const j = reply.match(/^\s*\{[\s\S]*\}\s*$/) ? JSON.parse(reply) : null;
    if (j?.task) {
      const r = await fetch(`${API}/api/task`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: j.task, context: j.context, source_app: 'Ambiguous', created_by: `${NAME}@ambiguous` }) });
      const { id: taskId } = await r.json();
      reply = `On it — created **${j.task}** on the board. I'll post the result here when it's done.`;
      if (taskId) state.mentions.push(`t-${taskId}`);
    }
    const thread = m.thread_key || m.thread?.key || undefined;
    await ambi('POST', `/api/channels/${m.channel_id || (await channel())}/messages`, thread ? { content: reply, thread_key: thread } : { content: reply, parent_id: id });
    state.mentions.push(id); state.mentions = state.mentions.slice(-500); save(); log('replied to mention');
  }
}

// ---------- loop ----------
log(`${NAME} online — Ambiguous ${AMBI} #${CHANNEL} · model ${MODEL} @ ${LLM} · Crewboard ${API} · ${env.SUPABASE_SERVICE_ROLE_KEY ? 'per-user coworkers' : 'team key only'}${AKEY ? '' : ' · no team key'}${DRY ? ' · DRY RUN' : ''}`);
let stopping = false;
process.on('SIGINT', () => { stopping = true; }); process.on('SIGTERM', () => { stopping = true; });
while (!stopping) {
  for (const job of [deliver, askHumans, converse]) { try { await job(); } catch (e) { log(job.name, e.message); } }
  await delay(POLL_MS);
}
