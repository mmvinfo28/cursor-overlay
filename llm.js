// Proposals through the CLI you're already logged into — Claude Code, Codex, Gemini — so a plan is enough,
// no API key. Each runner gets the prompt on stdin, must print JSON, and gets a hard timeout.
const { spawn, execSync } = require('child_process');

function killTree(ps) {
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${ps.pid} /T /F`, { stdio: 'ignore', windowsHide: true });
    else ps.kill();
  } catch {}
}

const TIMEOUT_MS = 40000;

const SYSTEM = app =>
  `You watch text a user is typing in ${app || 'an app'}. ` +
  `If it contains a concrete commitment or task an AI crew could do for them (make a file, research, draft, code), ` +
  `answer {"propose":true,"title":"<imperative, max 8 words>"}. Otherwise {"propose":false}. Most messages are not tasks. ` +
  `Reply with the JSON object only, nothing else.`;

const RUNNERS = {
  // claude -p reads the prompt from stdin; haiku keeps it snappy
  claude: { cmd: 'claude', args: ['-p', '--model', 'haiku', '--output-format', 'text'] },
  // codex exec reads stdin when no prompt is given; read-only sandbox, no repo needed
  codex:  { cmd: 'codex', args: ['exec', '--skip-git-repo-check', '-s', 'read-only'] },
  gemini: { cmd: 'gemini', args: ['-p', 'Answer the request in the input with the JSON object only.'] },
};

function which(cmd) {
  try {
    const out = execSync(process.platform === 'win32' ? `where.exe ${cmd}` : `command -v ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).toString().trim();
    return out.split(/\r?\n/)[0] || null;
  } catch { return null; }
}

// { claude: '/path' | null, codex: ..., gemini: ... }
function detect() {
  const found = {};
  for (const k of Object.keys(RUNNERS)) found[k] = which(RUNNERS[k].cmd);
  return found;
}

function parse(raw) {
  const m = String(raw || '').match(/\{[\s\S]*?\}/g);
  if (!m) return null;
  for (const cand of m.reverse()) {           // the last JSON object is the answer; earlier ones are tool logs
    try { const o = JSON.parse(cand); if ('propose' in o) return { propose: !!o.propose, title: o.title ? String(o.title).slice(0, 80) : undefined }; } catch {}
  }
  return null;
}

function run(name, text, app, log) {
  const r = RUNNERS[name];
  if (!r) return Promise.reject(new Error(`unknown proposer ${name}`));
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const ps = spawn(r.cmd, r.args, { shell: process.platform === 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', done = false;
    const finish = (parsed, code) => {
      if (done) return; done = true; clearTimeout(t);
      log(name, 'proposer', `${Date.now() - started}ms`, code === undefined ? 'early' : 'exit ' + code, parsed ? JSON.stringify(parsed) : 'no json: ' + (out || err).slice(-160).replace(/\s+/g, ' '));
      if (parsed) resolve({ ...parsed, provider: name }); else reject(new Error(`${name}: no JSON in output`));
    };
    const t = setTimeout(() => { killTree(ps); if (!done) { done = true; reject(new Error(`${name} timed out`)); } }, TIMEOUT_MS);
    ps.stdout.on('data', d => { out += d; const p = parse(out); if (p) { finish(p); killTree(ps); } });   // answer seen: don't wait for the CLI to wind down
    ps.stderr.on('data', d => { err += d; });
    ps.on('error', e => { if (!done) { done = true; clearTimeout(t); reject(e); } });
    ps.on('close', code => finish(parse(out), code));
    ps.stdin.end(`${SYSTEM(app)}\n\nText:\n${text}\n`);
  });
}

module.exports = { run, detect, RUNNERS };
