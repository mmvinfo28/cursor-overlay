// Pulls finished deliverables from Supabase into a local folder, so results land where you already
// look: OneDrive (synced), Desktop, or any folder set in config.json. Polls REST with the anon key;
// no Supabase client library needed.
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'config.json');
const POLL_MS = 3000;

function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch {}
  if (!cfg.supabaseUrl || !cfg.anonKey) return null;
  cfg.resultsDir = cfg.resultsDir || defaultResultsDir();
  return cfg;
}

// OneDrive if the machine has one (it syncs for free), else Desktop
function defaultResultsDir() {
  const od = process.env.OneDrive || process.env.OneDriveCommercial || process.env.OneDriveConsumer;
  const base = od && fs.existsSync(od) ? od : path.join(os.homedir(), 'Desktop');
  return path.join(base, 'Crewboard');
}

// folder per task: "2026-09-12 q3 numbers into a sheet"
function taskFolder(cfg, d) {
  const day = (d.created_at || '').slice(0, 10);
  const title = ((d.tasks && d.tasks.title) || d.task_id).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 60);
  return path.join(cfg.resultsDir, `${day} ${title}`);
}

async function save(cfg, d, log) {
  const dir = taskFolder(cfg, d);
  fs.mkdirSync(dir, { recursive: true });
  const safe = d.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  let file;
  if (d.kind === 'file' && d.url) {
    file = path.join(dir, safe);
    if (!fs.existsSync(file)) {
      const r = await fetch(d.url);
      if (!r.ok) throw new Error(`download ${r.status} ${d.url}`);
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    }
  } else if (d.kind === 'pr' && d.url) {
    file = path.join(dir, safe + '.url');                       // Windows internet shortcut, double-click opens the PR
    fs.writeFileSync(file, `[InternetShortcut]\r\nURL=${d.url}\r\n`);
  } else {
    file = path.join(dir, safe + '.md');
    fs.writeFileSync(file, (d.body || d.url || '') + os.EOL);
  }
  log('RESULT SAVED', d.kind, '->', file);
  return file;
}

// state: which deliverable ids we already have, so restarts don't re-download or re-toast
function stateFile(cfg) { return path.join(cfg.resultsDir, '.synced.json'); }
function loadState(cfg) {
  try { return new Set(JSON.parse(fs.readFileSync(stateFile(cfg), 'utf8'))); } catch { return new Set(); }
}
function saveState(cfg, seen) {
  fs.mkdirSync(cfg.resultsDir, { recursive: true });
  fs.writeFileSync(stateFile(cfg), JSON.stringify([...seen]));
}

async function fetchNew(cfg) {
  const url = `${cfg.supabaseUrl}/rest/v1/deliverables?select=*,tasks(title)&order=created_at.desc&limit=50`;
  const r = await fetch(url, { headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}` } });
  if (!r.ok) throw new Error(`deliverables ${r.status}`);
  return r.json();
}

// onResult({ name, file, dir, kind, title }) fires once per new deliverable — main.js turns it into a toast
function start({ log, onResult }) {
  const cfg = loadConfig();
  if (!cfg) { log('results: no config.json (supabaseUrl, anonKey) — results sync off'); return null; }
  const seen = loadState(cfg);
  let quiet = seen.size === 0;                                   // first run: pull history silently
  log('results: syncing to', cfg.resultsDir, quiet ? '(first run: pulling everything, no toasts)' : '');

  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const rows = (await fetchNew(cfg)).reverse();             // oldest first
      let dirty = false;
      for (const d of rows) {
        if (seen.has(d.id)) continue;
        try {
          const file = await save(cfg, d, log);
          seen.add(d.id); dirty = true;
          if (!quiet) onResult({ name: d.name, file, dir: path.dirname(file), kind: d.kind, title: d.tasks && d.tasks.title });
        } catch (e) { log('results: save failed', d.id, e.message); }
      }
      if (dirty) saveState(cfg, seen);
      quiet = false;
    } catch (e) { log('results: poll failed', e.message); }
    busy = false;
  }
  tick();
  const timer = setInterval(tick, POLL_MS);
  return { stop: () => clearInterval(timer), dir: cfg.resultsDir };
}

module.exports = { start, defaultResultsDir };
