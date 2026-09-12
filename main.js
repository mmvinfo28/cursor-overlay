const { app, BrowserWindow, Tray, Menu, nativeImage, shell, screen, globalShortcut, desktopCapturer, ipcMain, clipboard } = require('electron');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');
const results = require('./results');
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

// double-tap while a proposal is showing: the proposal is the task. Otherwise selection / crop become the task.
async function sendProposal(p) {
  const c = screen.getCursorScreenPoint();
  const crop = await captureRect(quickRect(c.x, c.y)).catch(e => { log('crop for task failed', e.message); return null; });
  win.webContents.send('fired');
  await crew.send({ title: p.title, context: p.context, app: p.app, cropPng: crop && crop.toPNG() });
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
  const p = crew && (crew.takeProposal() || (taskLabelActive ? crew.fromField(lastField) : null));
  if (p) {
    taskLabelActive = false;
    log('task confirmed', p.title);
    if (!win.isDestroyed()) win.webContents.send('task-label-confirmed');
    return sendProposal(p).catch(e => { log('SEND FAIL', e.message); toastAtCursor({ text: `✗ could not send: ${e.message}`, kind: 'fail' }); });
  }
  startSelect();
  const text = await grabSelectedText().catch(e => { log('text grab failed', e.message); return null; });
  if (text && selecting) {
    endSelect();
    saveText(text);
    if (crew) crew.send({ title: text.replace(/\s+/g, ' ').trim().slice(0, 80), context: text, app: lastField.app })
      .catch(e => { log('SEND FAIL', e.message); toastAtCursor({ text: `✗ could not send: ${e.message}`, kind: 'fail' }); });
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
    { label: 'Results folder', click: () => { if (resultsSync) shell.openPath(resultsSync.dir); } },
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
  createTray();
  startHelpers();
  startUpdater();
  if (app.isPackaged && !process.argv.includes('--no-autostart')) app.setLoginItemSettings({ openAtLogin: true });

  // finished deliverables land in OneDrive/Desktop/Crewboard, announce themselves at the cursor, refresh the feed
  resultsSync = results.start({
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

  const cfg = resultsSync ? resultsSync.cfg : results.loadConfig(CONFIG_FILE);
  if (cfg) {
    crew = crewmod.create({
      cfg, log, onToast: toastAtCursor,
      onProposal: ({ title }) => { taskLabelActive = true; if (!win.isDestroyed()) win.webContents.send('proposal', { title }); },
      onSent: () => feed.webContents.send('refresh'), onUpdate: () => feed.webContents.send('refresh')
    });
    log('crew: api', crew.api, 'as', crew.who);
  } else log('crew: no config, spine off');

  ipcMain.handle('config', () => cfg);
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
      const app = lastField.app || 'screen';
      return crew.send({ title: `Screenshot from ${app}`, context: lastField.text ? lastField.text.slice(0, 500) : null, app, cropPng: crop.toPNG() });
    }).catch(e => { log('CAPTURE/SEND FAIL', e.message); toastAtCursor({ text: `✗ ${e.message}`, kind: 'fail' }); });
  });
  ipcMain.on('cancel', () => { log('cancel'); endSelect(); });

  if (process.argv.includes('--selftest')) {
    const p = screen.getCursorScreenPoint();
    setTimeout(() => captureRect(quickRect(p.x, p.y)).catch(e => log('CAPTURE FAIL', e.message)), 1500);
  }
  if (process.argv.includes('--selftest-feed')) {              // open the feed, save a screenshot of it, keep running
    setTimeout(async () => {
      toggleFeed(true);
      await sleep(2500);
      const img = await feed.webContents.capturePage();
      fs.mkdirSync(CAPTURE_DIR, { recursive: true });
      const file = path.join(CAPTURE_DIR, 'feed.png');
      fs.writeFileSync(file, img.toPNG());
      log('FEED SHOT', file);
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
