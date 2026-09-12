const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, screen, globalShortcut, desktopCapturer, ipcMain, clipboard } = require('electron');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');
const results = require('./results');
const { zipDir } = require('./zipdir');
const crewmod = require('./crew');
const fs = require('fs');
const os = require('os');
const path = require('path');

const QUICK_RADIUS = 200; // DIP: a plain click (no drag) grabs a 400x400 box around it
const READER = process.argv.includes('--reader') || app.isPackaged; // field reader: opt-in in dev, always on when installed
let showPanel = process.argv.includes('--panel');      // the live field-text panel is a debug surface: hidden unless asked

// installed: user files live in %APPDATA%\Crewboard, helpers are unpacked next to the asar.
// dev: everything sits in the repo folder, as before.
const USER_DIR = app.isPackaged ? app.getPath('userData') : __dirname;
const WIN = process.platform === 'win32';
const HELPER_DIR = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'helpers', 'win');
const CAPTURE_DIR = path.join(USER_DIR, 'captures');
const CONFIG_FILE = path.join(USER_DIR, 'config.json');
const ICON = path.join(__dirname, 'icon.png');

let win;
let feed = null;
let tray = null;
let selecting = false;
let taskLabelActive = false;
let fieldReaderPrimed = false;
let uiaHelper = null;
let resultsSync = null;
let crew = null;                 // the spine (crew.js): propose → send → track
let compose = null;              // "Create a task" composer: title, context, attachments
let composing = false;
let lastField = { app: null, text: '' };

ipcMain.on('task-label-state', (_, active) => { taskLabelActive = active === true; });

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
const LOG_FILE = path.join(USER_DIR, 'overlay.log');
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
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
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
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HELPER_DIR, script)],
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
  if (!WIN) return log('helpers: not on', process.platform, '- capture/field reader off, feed + results sync on');
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
  const signalPass = fieldReaderPrimed && pass;
  fieldReaderPrimed = true;
  log('field', f.app, f.type, `${f.len}ch`, f.src, pass ? 'PASS' : 'silent', signals.join(','));
  lastField = { app: f.app, text: f.text || '' };
  if (pass && crew) crew.onField(f);
  if (!win.isDestroyed()) {
    win.webContents.send('signal', { pass: signalPass, text: f.text || '' });
    if (showPanel) win.webContents.send('field', { ...f, pass, signals });
  }
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

function toastAtCursor({ text, kind, ttl }) {
  const p = screen.getCursorScreenPoint();
  if (!win.isDestroyed()) win.webContents.send('toast', { text, x: p.x, y: p.y, kind, ttl });
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
  // double-tap while the "Create a task" pill is up: the proposal (model title) or, if the model hasn't answered
  // yet, the current line itself becomes the task. The pill flips to "Task selected", crew.js sends it.
  if (composing) { compose.webContents.send('compose-send-now'); return; }   // second double-tap = send as is
  const p = crew && (crew.takeProposal() || (taskLabelActive ? crew.fromField(lastField) : null));
  if (p) {
    taskLabelActive = false;
    log('task confirmed', p.title);
    if (!win.isDestroyed()) win.webContents.send('task-label-confirmed');
    win.webContents.send('fired');
    return openCompose({ title: p.title, context: p.context, app: p.app });
  }
  startSelect();
  const text = await grabSelectedText().catch(e => { log('text grab failed', e.message); return null; });
  if (text && selecting) {
    endSelect();
    saveText(text);
    if (crew) openCompose({ title: text.replace(/\s+/g, ' ').trim().slice(0, 80), context: text, app: lastField.app });
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

// ---- feed: the "what the crew did for me" window. Frameless, hides instead of closing, lives in the tray ----
function createFeed() {
  feed = new BrowserWindow({
    width: 440, height: 680, minWidth: 360, minHeight: 400,
    show: false, frame: false, backgroundColor: '#141416', icon: ICON,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  feed.loadFile('feed.html');
  feed.on('close', e => { if (!app.quitting) { e.preventDefault(); feed.hide(); } });
}

// ---- composer: small focusable window at the cursor. Enter/Send → crew.send, Esc → nothing happens ----
function createCompose() {
  compose = new BrowserWindow({
    width: 480, height: 400, show: false, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, minimizable: false, maximizable: false, hasShadow: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  compose.setAlwaysOnTop(true, 'screen-saver');
  compose.loadFile('compose.html');
  compose.on('blur', () => {});                       // stays open until Send / Esc / ✕
}

let pendingTask = null;          // what the composer is editing: { app }
function openCompose({ title, context, app, cropPng }) {
  composing = true;
  pendingTask = { app };
  const c = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(c);
  const [w, h] = compose.getSize();
  const x = Math.max(workArea.x + 8, Math.min(c.x + 20, workArea.x + workArea.width - w - 8));
  const y = Math.max(workArea.y + 8, Math.min(c.y + 20, workArea.y + workArea.height - h - 8));
  compose.setPosition(Math.round(x), Math.round(y));
  compose.webContents.send('compose-open', { title, context, app, crop: cropPng ? { base64: cropPng.toString('base64'), size: cropPng.length } : null });
  compose.show(); compose.focus();
}
function closeCompose() { composing = false; pendingTask = null; if (compose && compose.isVisible()) compose.hide(); }

// "Add context from…" — each source answers with text (appended to context) or an attachment
async function composeAdd(kind) {
  const reply = a => compose.webContents.send('compose-attach', a);
  if (kind === 'file') {
    const r = await dialog.showOpenDialog(compose, { properties: ['openFile', 'multiSelections'] });
    for (const f of r.filePaths || []) {
      const st = fs.statSync(f);
      if (st.size > 25 * 1024 * 1024) { toastAtCursor({ text: `✗ ${path.basename(f)} is over 25 MB`, kind: 'fail' }); continue; }
      const ext = path.extname(f).toLowerCase();
      const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf', '.csv': 'text/csv', '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }[ext] || 'application/octet-stream';
      reply({ name: path.basename(f), mime, size: st.size, base64: fs.readFileSync(f).toString('base64') });
    }
    compose.focus();
  } else if (kind === 'folder') {
    const r = await dialog.showOpenDialog(compose, { properties: ['openDirectory'] });
    const dir = r.filePaths && r.filePaths[0];
    if (dir) {
      const z = zipDir(dir);
      const name = path.basename(dir) + '.zip';
      reply({ name, mime: 'application/zip', size: z.buffer.length, base64: z.buffer.toString('base64'), kind: 'folder', path: dir });
      reply({ text: `Folder ${dir} (${z.count} files${z.skipped ? `, ${z.skipped} skipped: >10 MB or over the 24 MB total` : ''}):\n` + z.listing.map(f => '  ' + f).join('\n') + (z.listing.length < z.count ? '\n  …' : '') });
      log('folder attached', dir, z.count, 'files', z.buffer.length, 'bytes');
    }
    compose.focus();
  } else if (kind === 'clipboard') {
    const img = clipboard.readImage();
    const text = clipboard.readText().trim();
    if (!img.isEmpty()) { const png = img.toPNG(); reply({ name: 'clipboard.png', mime: 'image/png', size: png.length, base64: png.toString('base64') }); }
    else if (text) reply({ text });
    else toastAtCursor({ text: 'Clipboard is empty', kind: 'fail' });
  } else if (kind === 'field') {
    const t = (lastField.text || '').trim();
    if (t) reply({ text: t.slice(0, 4000) }); else toastAtCursor({ text: 'No text read from the last field', kind: 'fail' });
  } else if (kind === 'cursor') {
    compose.hide();
    await sleep(150);
    const c = screen.getCursorScreenPoint();
    const crop = await captureRect(quickRect(c.x, c.y)).catch(e => { log('crop failed', e.message); return null; });
    compose.show(); compose.focus();
    if (crop) { const png = crop.toPNG(); reply({ name: `cursor-${Date.now()}.png`, mime: 'image/png', size: png.length, base64: png.toString('base64') }); }
  } else if (kind === 'region') {
    compose.hide();                                    // let the user drag on the overlay, then come back
    await sleep(150);
    startSelect();
    regionForCompose = true;
  }
}
let regionForCompose = false;

function toggleFeed(focusNew) {
  if (feed.isVisible() && feed.isFocused() && !focusNew) return feed.hide();
  if (!feed.isVisible()) {
    const { workArea } = screen.getPrimaryDisplay();          // bottom-right, above the taskbar
    const [w, h] = feed.getSize();
    feed.setPosition(workArea.x + workArea.width - w - 16, workArea.y + workArea.height - h - 16);
  }
  feed.show(); feed.focus();
  if (focusNew) feed.webContents.send('focus-new');
}

function createTray() {
  const img = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Crewboard');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Crewboard', click: () => toggleFeed(true) },
    { label: 'Open results folder', click: () => { if (resultsSync) shell.openPath(resultsSync.dir); } },
    { label: 'Change results folder…', click: () => chooseResultsDir() },
    { type: 'separator' },
    { label: 'Show field reader (debug)', type: 'checkbox', checked: showPanel, enabled: READER,
      click: m => { showPanel = m.checked; if (!showPanel) win.webContents.send('field-hide'); } },
    { label: WIN ? 'Start with Windows' : 'Start at login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: m => app.setLoginItemSettings({ openAtLogin: m.checked }) },
    { label: `Check for updates (v${app.getVersion()})`, enabled: app.isPackaged,
      click: () => autoUpdater.checkForUpdates().then(r => { if (!r || !r.updateInfo || r.updateInfo.version === app.getVersion()) { const p = screen.getCursorScreenPoint(); win.webContents.send('toast', { text: `Crewboard v${app.getVersion()} is up to date`, x: p.x, y: p.y }); } }).catch(e => log('update check failed', e.message)) },
    { label: 'Restart to update', click: () => { app.quitting = true; autoUpdater.quitAndInstall(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.quitting = true; app.quit(); } }
  ]));
  tray.on('click', () => toggleFeed(false));
}

// ---- auto-update: GitHub Releases. Checks at start and hourly; installs silently on quit ----
function startUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.logger = { info: (...a) => log('update', ...a), warn: (...a) => log('update warn', ...a), error: (...a) => log('update error', ...a), debug: () => {} };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', info => {
    const p = screen.getCursorScreenPoint();
    win.webContents.send('toast', { text: `Crewboard ${info.version} ready — restart from the tray to update`, x: p.x, y: p.y });
    if (tray) tray.setToolTip(`Crewboard — update ${info.version} ready`);
  });
  const check = () => autoUpdater.checkForUpdates().catch(e => log('update check failed', e.message));
  setTimeout(check, 10000);
  setInterval(check, 60 * 60 * 1000);
}

// pick where results go; saved in config.json, sync restarts on the new folder
async function chooseResultsDir() {
  const r = await dialog.showOpenDialog({ title: 'Where should Crewboard save results?', properties: ['openDirectory', 'createDirectory'],
    defaultPath: resultsSync ? resultsSync.dir : undefined });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0];
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch {}
  cfg.resultsDir = dir;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  if (resultsSync) resultsSync.stop();
  resultsSync = startResultsSync();
  log('results dir ->', dir);
  return dir;
}

// finished deliverables land in the results folder, announce themselves at the cursor, refresh the feed
function startResultsSync() {
  return results.start({
    log,
    configFile: CONFIG_FILE,
    onResult: ({ title, dir, names }) => {
      const p = screen.getCursorScreenPoint();
      const where = dir.replace(os.homedir(), '~');
      win.webContents.send('toast', { text: `✓ ${title || names[0]}\n${names.join(', ')} → ${where}`, x: p.x, y: p.y });
      win.webContents.send('fired');
      feed.webContents.send('refresh');
    }
  });
}

// first run of the installed app: seed config.json from the bundled default
function ensureConfig() {
  if (fs.existsSync(CONFIG_FILE)) return;
  try {
    fs.mkdirSync(USER_DIR, { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'config.default.json'), CONFIG_FILE);
    log('config seeded at', CONFIG_FILE);
  } catch (e) { log('config seed failed', e.message); }
}

// one overlay per machine: a second launch just opens the feed of the running one
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (feed) toggleFeed(true); });

app.whenReady().then(() => {
  log('Crewboard', app.getVersion(), app.isPackaged ? 'packaged' : 'dev', process.platform);
  ensureConfig();
  if (process.platform === 'darwin' && app.dock) app.dock.hide();  // tray app, no dock icon
  createOverlay();
  createFeed();
  createCompose();
  createTray();
  startHelpers();
  startUpdater();
  if (app.isPackaged && !process.argv.includes('--no-autostart')) app.setLoginItemSettings({ openAtLogin: true });

  resultsSync = startResultsSync();

  const cfg = resultsSync ? resultsSync.cfg : results.loadConfig(CONFIG_FILE);
  if (cfg) {
    crew = crewmod.create({
      cfg, log, onToast: toastAtCursor,
      onProposal: ({ title }) => { taskLabelActive = true; if (!win.isDestroyed()) win.webContents.send('proposal', { title }); },
      onSent: () => feed.webContents.send('refresh'), onUpdate: () => feed.webContents.send('refresh')
    });
    log('crew: api', crew.api, 'as', crew.who);
  } else log('crew: no config, spine off');

  ipcMain.handle('config', () => resultsSync ? resultsSync.cfg : cfg);
  ipcMain.handle('choose-results-dir', () => chooseResultsDir());
  ipcMain.handle('local-files', () => resultsSync ? resultsSync.localFiles() : {});
  ipcMain.on('feed-hide', () => feed.hide());
  ipcMain.on('open-results-dir', () => { if (resultsSync) shell.openPath(resultsSync.dir); });
  globalShortcut.register('CommandOrControl+Shift+C', () => toggleFeed(true));

  globalShortcut.register('Control+Shift+Space', onHotkey);   // fallback if the Shift hook is unavailable
  ipcMain.on('region', (_, rect) => {
    log('region', rect);
    endSelect();
    captureRect(rect).then(crop => {
      if (!crop || !crew) return;
      const png = crop.toPNG();
      if (regionForCompose) {                        // came from the composer's "Screen region" button
        regionForCompose = false;
        compose.webContents.send('compose-attach', { name: `region-${Date.now()}.png`, mime: 'image/png', size: png.length, base64: png.toString('base64') });
        compose.show(); compose.focus();
        return;
      }
      const app = lastField.app || 'screen';
      openCompose({ title: `Screenshot from ${app}`, context: lastField.text ? lastField.text.slice(0, 500) : '', app, cropPng: png });
    }).catch(e => { log('CAPTURE FAIL', e.message); toastAtCursor({ text: `✗ ${e.message}`, kind: 'fail' }); });
  });
  ipcMain.on('cancel', () => { log('cancel'); endSelect(); if (regionForCompose) { regionForCompose = false; compose.show(); compose.focus(); } });

  ipcMain.on('compose-add', (_, kind) => composeAdd(kind).catch(e => { log('compose add failed', kind, e.message); }));
  ipcMain.on('compose-cancel', () => { log('compose cancel'); closeCompose(); });
  ipcMain.on('compose-send', (_, { title, context, attachments }) => {
    const app = pendingTask && pendingTask.app;
    closeCompose();
    crew.send({ title, context, app, attachments })
      .catch(e => { log('SEND FAIL', e.message); toastAtCursor({ text: `✗ could not send: ${e.message}`, kind: 'fail' }); });
  });

  if (process.argv.includes('--selftest')) {
    const p = screen.getCursorScreenPoint();
    setTimeout(() => captureRect(quickRect(p.x, p.y)).catch(e => log('CAPTURE FAIL', e.message)), 1500);
  }
  if (process.argv.includes('--selftest-feed')) {              // open the feed, save a screenshot of it, keep running
    setTimeout(async () => {
      toggleFeed(true);
      await sleep(2500);
      fs.mkdirSync(CAPTURE_DIR, { recursive: true });
      for (const tab of ['tasks', 'results']) {
        await feed.webContents.executeJavaScript(`document.getElementById('tab-${tab}').click()`);
        await sleep(600);
        const img = await feed.webContents.capturePage();
        const file = path.join(CAPTURE_DIR, `feed-${tab}.png`);
        fs.writeFileSync(file, img.toPNG());
        log('FEED SHOT', file);
      }
    }, 1500);
  }
  if (process.argv.includes('--selftest-compose')) {           // open the composer with sample content, screenshot it
    setTimeout(async () => {
      openCompose({ title: "Compare the three vendor quotes", context: "I'll compare the three vendor quotes and send Ana a sheet by Monday", app: 'Slack' });
      await sleep(1500);
      const img = await compose.webContents.capturePage();
      fs.mkdirSync(CAPTURE_DIR, { recursive: true });
      const file = path.join(CAPTURE_DIR, 'compose.png');
      fs.writeFileSync(file, img.toPNG());
      log('COMPOSE SHOT', file);
      if (process.argv.includes('--selftest-compose-send')) {   // attach a crop + a link, then send as the user would
        const c = screen.getCursorScreenPoint();
        const crop = await captureRect(quickRect(c.x, c.y));
        compose.webContents.send('compose-attach', { name: 'selftest-crop.png', mime: 'image/png', size: crop.toPNG().length, base64: crop.toPNG().toString('base64') });
        compose.webContents.send('compose-attach', { name: 'https://example.com/spec', url: 'https://example.com/spec', kind: 'link' });
        compose.webContents.send('compose-attach', { text: 'Extra context line from the clipboard.' });
        await sleep(500);
        compose.webContents.send('compose-send-now');
      }
    }, 1500);
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

app.on('window-all-closed', () => {});                          // tray app: overlay + feed stay alive
app.on('before-quit', () => { app.quitting = true; });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (resultsSync) resultsSync.stop();
  if (helper) helper.kill();
  if (shiftHelper) shiftHelper.kill();
  if (uiaHelper) uiaHelper.kill();
});
