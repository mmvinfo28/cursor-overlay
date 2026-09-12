// The spine: field text → proposal at the cursor → double-tap → task on the board → progress back at the cursor.
//   propose(field)   debounced; asks /api/propose (OpenRouter) — or a local heuristic when the server has no key
//   send(...)        POST /api/task with text + app + optional crop
//   track(id)        polls the task row until it's done; reports claim / needs-human / done / failed
const os = require('os');

const PROPOSE_DEBOUNCE_MS = 700;
const PROPOSAL_TTL_MS = 6000;      // a proposal you ignore dies after this
const TRACK_POLL_MS = 3000;
const TRACK_MAX_MS = 30 * 60 * 1000;

function create({ cfg, log, onToast, onProposal, onSent, onUpdate }) {
  const api = (cfg.apiBase || 'https://crewboard-web.vercel.app').replace(/\/$/, '');
  const who = cfg.user || `${os.userInfo().username}@${os.hostname()}`;
  const headers = { 'Content-Type': 'application/json' };
  const sb = { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}` };

  let timer = null;
  let seq = 0;
  let proposal = null;             // { title, context, app, at }
  let lastText = '';

  // ---- propose ----
  function localTitle(text) {
    const first = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] || text;
    const words = first.split(' ').slice(0, 8).join(' ');
    return words.length > 60 ? words.slice(0, 57) + '…' : words;
  }

  async function askServer(text, app) {
    const r = await fetch(`${api}/api/propose`, { method: 'POST', headers, body: JSON.stringify({ text, app }) });
    if (!r.ok) throw new Error(`propose ${r.status}`);
    return r.json();
  }

  // the sentence being written now: last non-empty line of the field (long documents would drown the model)
  function current(raw) {
    const lines = (raw || '').split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);   // RichEdit reports bare \r
    return lines.length ? lines[lines.length - 1].slice(-600) : '';
  }

  // called on every field line that passed the local filter
  function onField(f) {
    const text = current(f.text);
    if (text.length < 8 || text === lastText) return;
    lastText = text;
    clearTimeout(timer);
    const my = ++seq;
    timer = setTimeout(async () => {
      let out;
      try {
        out = await askServer(text, f.app);
        if (!out.propose && out.reason === 'no OPENROUTER_API_KEY' && cfg.localPropose !== false) out = { propose: true, title: localTitle(text), local: true };
      } catch (e) {
        log('propose failed', e.message);
        if (cfg.localPropose !== false) out = { propose: true, title: localTitle(text), local: true };
      }
      if (my !== seq || !out || !out.propose) return;
      proposal = { title: out.title, context: text, app: f.app, at: Date.now() };
      log('PROPOSE', out.local ? '(local)' : '(model)', out.title);
      onToast({ text: `↯ ${out.title}\nDouble-tap Shift to send to the crew`, kind: 'proposal', ttl: PROPOSAL_TTL_MS });
    }, PROPOSE_DEBOUNCE_MS);
  }

  // no model answer yet but the user confirmed: the line being typed is the task
  function fromField(field) {
    const text = current(field && field.text);
    if (text.length < 4) return null;
    return { title: localTitle(text), context: text, app: field.app, at: Date.now() };
  }

  function takeProposal() {
    if (proposal && Date.now() - proposal.at < PROPOSAL_TTL_MS) { const p = proposal; proposal = null; return p; }
    return null;
  }

  // ---- attachments: straight into Supabase Storage (anon upload policy), public URL back ----
  async function upload(a) {
    if (a.url && !a.base64) return { name: a.name, url: a.url, mime: a.mime || 'text/uri-list', kind: a.kind || 'link' };
    const safe = String(a.name || 'file').replace(/[^\w.-]+/g, '_').slice(0, 80);
    const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}/${safe}`;
    const buf = Buffer.from(a.base64, 'base64');
    const r = await fetch(`${cfg.supabaseUrl}/storage/v1/object/attachments/${key}`, {
      method: 'POST', headers: { ...sb, 'Content-Type': a.mime || 'application/octet-stream', 'x-upsert': 'false' }, body: buf
    });
    if (!r.ok) throw new Error(`upload ${r.status} ${(await r.text()).slice(0, 100)}`);
    return { name: a.name, url: `${cfg.supabaseUrl}/storage/v1/object/public/attachments/${key}`, mime: a.mime || null, size: buf.length, kind: 'file' };
  }

  // ---- send ----
  async function send({ title, context, app, cropPng, attachments = [] }) {
    const body = { title, context, source_app: app || null, created_by: who };
    if (cropPng) body.crop_base64 = cropPng.toString('base64');
    if (attachments.length) {
      body.attachments = [];
      for (const a of attachments) {
        try { body.attachments.push(await upload(a)); }
        catch (e) { log('attachment failed', a.name, e.message); onToast({ text: `✗ ${a.name}: ${e.message}`, kind: 'fail' }); }
      }
    }
    const r = await fetch(`${api}/api/task`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`task ${r.status} ${(await r.text()).slice(0, 120)}`);
    const { id } = await r.json();
    log('TASK SENT', id, title);
    onToast({ text: `→ ${title}\nsent to the crew`, kind: 'sent' });
    if (onSent) onSent(id);
    track(id, title);
    return id;
  }

  // ---- track ----
  function track(id, title) {
    const started = Date.now();
    let last = null;
    const tick = async () => {
      try {
        const r = await fetch(`${cfg.supabaseUrl}/rest/v1/tasks?id=eq.${id}&select=status,worker:workers(name),events(kind,payload,at)`, { headers: sb });
        if (!r.ok) throw new Error(`track ${r.status}`);
        const [t] = await r.json();
        if (!t) return;
        if (t.status !== last) {
          last = t.status;
          const w = t.worker && t.worker.name;
          log('TRACK', id.slice(0, 8), t.status, w || '');
          if (t.status === 'claimed' || t.status === 'running') onToast({ text: `${w || 'a worker'} is on it — ${title}`, kind: 'progress' });
          if (t.status === 'needs-human') {
            const q = (t.events || []).filter(e => e.kind === 'needs-human').pop();
            const question = (q && q.payload && q.payload.question) || 'The crew has a question.';
            onToast({ text: `? ${question}\nAnswer in the panel (Ctrl+Shift+C)`, kind: 'ask', ttl: 12000 });
          }
          if (t.status === 'failed') onToast({ text: `✗ ${title} failed`, kind: 'fail' });
          if (onUpdate) onUpdate({ id, status: t.status, worker: w });
        }
        if (t.status === 'done' || t.status === 'failed') return;   // done → results.js takes over (files + toast)
      } catch (e) { log('track', id, e.message); }
      if (Date.now() - started < TRACK_MAX_MS) setTimeout(tick, TRACK_POLL_MS);
    };
    setTimeout(tick, TRACK_POLL_MS);
  }

  return { onField, takeProposal, fromField, send, who, api };
}

module.exports = { create };
