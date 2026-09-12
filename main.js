const { app, BrowserWindow, screen, globalShortcut, desktopCapturer, ipcMain, clipboard } = require('electron');
const { spawn } = require('child_process');
const results = require('./results');
const fs = require('fs');
const os = require('os');
const path = require('path');

const QUICK_RADIUS = 200; // DIP: a plain click (no drag) grabs a 400x400 box around it
const CAPTURE_DIR = path.join(__dirname, 'captures');
const READER = process.argv.includes('--reader'); // spawn the UIA field reader + show the live panel

let win;
let selecting = false;
let uiaHelper = null;
let resultsSync = null;

// Cheap local filter: does the field look like it might carry an actionable commitment?
// Runs before any model call. A strong signal (date / time / filename / promise verb) passes;
// a bare number does not, so ordinary typing stays silent.
const PROMISE = /\b(i'?ll|i will|will|send|sending|share|follow up|get back|by eod|deadline|remind|schedule|trimit|o s[ăa]|voi |promit|termin|rezolv|revin|pân[ăa]|amân|programez)\b/i;
const DATE = /\b(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[.\/]\d{1,2}([.\/]\d{2,4})?|mon|tue|wed|thu|fri|sat|sun|today|tomorrow|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec|luni|mar[țt]i|miercuri|joi|vineri|s[âa]mb[ăa]t[ăa]|duminic[ăa]|azi|m[âa]ine|poim[âa]ine|ianuarie|februarie|martie|aprilie|mai|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie)\b/i;
const TIME = /\b(\d{1,2}:\d{2}|\d{1,2}\s?(am|pm)|ora\s?\d{1,2})\b/i;
const FILE = /\b[\w-]+\.(xlsx?|docx?|pdf|png|jpe?g|csv|txt|pptx?|zip|md|json|js|ts|py|sql)\b/i;
const NUM = /\b\d+\b/;

function localFilter(text) {
  const signals = [];
  if (DATE.test(text)) signals.push('date');
  if (TIME.test(text)) signals.push('time');
  if (FILE.test(text)) signals.push('file');
  if (PROMISE.test(text)) signals.push('promise');
  const weakNum = signals.length === 0 && NUM.test(text);
  if (weakNum) signals.push('number?');
  const strong = signals.some(s => s !== 'number?');
  return { pass: strong, signals };
}

// log to console and to overlay.log (the app is normally launched detached, without a console)
const LOG_FILE = path.join(__dirname, 'overlay.log');
function log(...a) {
  const line = [new Date().toISOString().slice(11, 23), ...a.map(v => typeof v === 'string' ? v : JSON.stringify(v))].join(' ');
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + os.EOL); } catch {}
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function withTimeout(promise, ms, what) {
  let t;
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

function createOverlay() {
  const { width, height } = screen.getPrimaryDisplay().size;

  win = new BrowserWindow({
    x: 0, y: 0, width, height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  win.setIgnoreMouseEvents(true, { forward: true });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile('overlay.html');
  win.webContents.on('render-process-gone', (_, d) => log('RENDERER GONE', d));
  win.webContents.on('unresponsive', () => log('RENDERER UNRESPONSIVE'));

  setInterval(() => {
    const p = screen.getCursorScreenPoint();
    if (!win.isDestroyed()) win.webContents.send('cursor', p);
  }, 16);
}

// ---- helpers: long-lived PowerShell processes, one line of stdout per event ----
//   keyhelper.ps1   injects Ctrl+C on request
//   shifthelper.ps1 watches the keyboard and reports double-tapped Shift
let helper = null;
let shiftHelper = null;
const helperQueue = [];

function spawnPs(script, onLine) {
  const ps = spawn('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, script)],
    { windowsHide: true });
  let buf = '';
  ps.stdout.on('data', d => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf(os.EOL)) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + os.EOL.length);
      if (line) onLine(line);
    }
  });
  ps.stderr.on('data', d => log(script, 'stderr', d.toString().trim()));
  ps.on('exit', code => log(script, 'exited', code));
  return ps;
}

function startHelpers() {
  helper = spawnPs('keyhelper.ps1', line => {
    if (line === 'ready') return log('key helper ready');
    const resolve = helperQueue.shift();
    if (resolve) resolve(line);
  });
  helper.on('exit', () => { helper = null; });

  shiftHelper = spawnPs('shifthelper.ps1', line => {
    if (line === 'ready') return log('shift helper ready');
    if (line !== 'dtap') return log('shift helper:', line);
    log('double shift');
    if (!process.argv.includes('--selftest-dtap')) onHotkey();
  });

  if (READER) {
    uiaHelper = spawnPs('uiahelper.ps1', onFieldLine);
    log('reader mode: UIA field reader on');
  }
}

// One JSON line from uiahelper.ps1 = the current focused field. Filter it, show it in the panel.
function onFieldLine(line) {
  if (line === 'ready') return log('uia helper ready');
  let f;
  try { f = JSON.parse(line); } catch { return log('uia parse fail', line.slice(0, 120)); }
  const { pass, signals } = localFilter(f.text || '');
  log('field', f.app, f.type, `${f.len}ch`, f.src, pass ? 'PASS' : 'silent', signals.join(','));
  if (!win.isDestroyed()) win.webContents.send('field', { ...f, pass, signals });
}

function helperCmd(cmd) {
  return new Promise((resolve, reject) => {
    if (!helper) return reject(new Error('key helper not running'));
    helperQueue.push(resolve);
    helper.stdin.write(cmd + os.EOL);
    setTimeout(() => {
      const i = helperQueue.indexOf(resolve);
      if (i >= 0) { helperQueue.splice(i, 1); reject(new Error('key helper timeout')); }
    }, 3000);
  });
}

// Copy whatever is selected in the foreground app and return it; the clipboard is put back afterwards.
async function grabSelectedText() {
  const saved = { text: clipboard.readText(), html: clipboard.readHTML(), image: clipboard.readImage() };
  clipboard.clear();
  try {
    const r = await helperCmd('copy');
    log('copy', r);
    if (!r.startsWith('sent')) return null;
    for (let i = 0; i < 16; i++) {            // give the app up to ~400ms to write the clipboard
      const text = clipboard.readText().trim();
      if (text) return text;
      await sleep(25);
    }
    return null;
  } finally {
    const data = {};
    if (saved.text) data.text = saved.text;
    if (saved.html) data.html = saved.html;
    if (!saved.image.isEmpty()) data.image = saved.image;
    if (Object.keys(data).length) clipboard.write(data); else clipboard.clear();
  }
}

function saveText(text) {
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  const file = path.join(CAPTURE_DIR, `text-${Date.now()}.txt`);
  fs.writeFileSync(file, text);
  log('TEXT OK', text.length, 'chars', text.slice(0, 80), '->', file);
  win.webContents.send('fired');
  const p = screen.getCursorScreenPoint();
  win.webContents.send('toast', { text, x: p.x, y: p.y });
}

// Ctrl+Shift+Space: ring pops immediately; if the app had text selected that wins,
// otherwise the user drags a rectangle (Esc / right-click cancels)
async function onHotkey() {
  if (selecting) return;
  startSelect();
  const text = await grabSelectedText().catch(e => { log('text grab failed', e.message); return null; });
  if (text && selecting) {
    endSelect();
    saveText(text);
  }
}

function startSelect() {
  if (selecting) return;
  selecting = true;
  log('select start');
  win.setIgnoreMouseEvents(false);
  globalShortcut.register('Escape', endSelect);
  win.webContents.send('select-start');
}

function endSelect() {
  if (!selecting) return;
  selecting = false;
  log('select end');
  globalShortcut.unregister('Escape');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.send('select-end');
}

// hide the overlay UI so it doesn't end up in the capture; renderer answers once two frames have painted
function hideUi() {
  return new Promise(resolve => {
    const t = setTimeout(done, 200);
    function done() { clearTimeout(t); ipcMain.removeListener('hidden', done); setTimeout(resolve, 30); }
    ipcMain.once('hidden', done);
    win.webContents.send('hide');
  });
}

function quickRect(cx, cy) {
  return { x: cx - QUICK_RADIUS, y: cy - QUICK_RADIUS, w: 2 * QUICK_RADIUS, h: 2 * QUICK_RADIUS };
}

// rect is in DIP screen coords
async function captureRect(rect) {
  if (rect.w < 4 || rect.h < 4) rect = quickRect(rect.x + rect.w / 2, rect.y + rect.h / 2);
  log('capture', rect);
  await hideUi();
  log('ui hidden');
  try {
    return await grab(rect);
  } finally {
    win.webContents.send('show');
  }
}

async function grab(rect) {
  const display = screen.getPrimaryDisplay();
  const sources = await withTimeout(desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor)
    }
  }), 5000, 'desktopCapturer.getSources');
  log('sources', sources.length);
  const src = sources.find(s => String(s.display_id) === String(display.id)) || sources[0];
  const img = src.thumbnail;
  const { width: iw, height: ih } = img.getSize();

  // image is in physical px: scale the DIP rect, then keep it inside the image
  const k = iw / display.size.width;
  const w = Math.min(Math.round(rect.w * k), iw);
  const h = Math.min(Math.round(rect.h * k), ih);
  const x = Math.max(0, Math.min(Math.round((rect.x - display.bounds.x) * k), iw - w));
  const y = Math.max(0, Math.min(Math.round((rect.y - display.bounds.y) * k), ih - h));
  const crop = img.crop({ x, y, width: w, height: h });

  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  const file = path.join(CAPTURE_DIR, `crop-${Date.now()}.png`);
  fs.writeFileSync(file, crop.toPNG());
  log('CAPTURE OK', `${iw}x${ih}`, 'crop', `${w}x${h} @ ${x},${y}`, '->', file);
  win.webContents.send('fired');
  return crop;
}

app.whenReady().then(() => {
  createOverlay();
  startHelpers();

  // finished deliverables land in OneDrive/Desktop/Crewboard and announce themselves at the cursor
  resultsSync = results.start({
    log,
    onResult: ({ name, dir, kind, title }) => {
      const p = screen.getCursorScreenPoint();
      const where = dir.replace(os.homedir(), '~');
      win.webContents.send('toast', { text: `✓ ${title || name}
${kind === 'pr' ? 'PR' : name} → ${where}`, x: p.x, y: p.y });
      win.webContents.send('fired');
    }
  });

  globalShortcut.register('Control+Shift+Space', onHotkey);   // fallback if the Shift hook is unavailable
  ipcMain.on('region', (_, rect) => {
    log('region', rect);
    endSelect();
    captureRect(rect).catch(e => log('CAPTURE FAIL', e.message));
  });
  ipcMain.on('cancel', () => { log('cancel'); endSelect(); });

  if (process.argv.includes('--selftest')) {
    const p = screen.getCursorScreenPoint();
    setTimeout(() => captureRect(quickRect(p.x, p.y)).catch(e => log('CAPTURE FAIL', e.message)), 1500);
  }
  if (process.argv.includes('--selftest-toast')) {
    setTimeout(() => {
      const p = screen.getCursorScreenPoint();
      win.webContents.send('toast', { text: 'Toast test: ' + 'lorem ipsum dolor sit amet '.repeat(12), x: p.x, y: p.y });
    }, 2000);
  }
  if (process.argv.includes('--selftest-text')) {
    setTimeout(() => grabSelectedText()
      .then(t => log('selftest text:', t === null ? null : `${t.length} chars`))
      .catch(e => log('selftest text failed', e.message)), 2500);
  }
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (resultsSync) resultsSync.stop();
  if (helper) helper.kill();
  if (shiftHelper) shiftHelper.kill();
  if (uiaHelper) uiaHelper.kill();
});
