const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function harness(capture) {
  const events = [];
  const shortcuts = new Map();
  const electron = {
    app: { isPackaged: false, requestSingleInstanceLock: () => true, on() {}, whenReady: () => ({ then() {} }) },
    ipcMain: { on() {} },
    screen: { getCursorScreenPoint: () => ({ x: 600, y: 400 }) },
    globalShortcut: { register: (key, callback) => shortcuts.set(key, callback), unregister: key => shortcuts.delete(key) },
  };
  const context = vm.createContext({
    require: name => name === 'electron' ? electron : name === 'electron-updater' ? {} : name === 'fs' ? { appendFileSync() {} } : name.startsWith('./') ? {} : require(name),
    __dirname: path.join(__dirname, '..'), process, console, Buffer, setTimeout, clearTimeout,
    events, capture: capture || (async rect => { events.push(['captured', rect]); return { toPNG: () => Buffer.from('png') }; }),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8') + `
    log = () => {};
    win = { setIgnoreMouseEvents: value => events.push(['ignore', value]), webContents: { send: (...args) => events.push(args) } };
    compose = { show: () => events.push(['show']), focus() {}, webContents: { send: (...args) => events.push(args) } };
    crew = {};
    captureRect = capture;
    toastAtCursor = toast => events.push(['toast', toast]);
    openCompose = payload => events.push(['open', payload]);
    lastField = { app: 'Notepad', text: 'Context' };
    globalThis.api = {
      startSelect, cancelSelect, completeSelection, onHotkey,
      fromComposer() { composing = true; regionForCompose = true; startSelect(); },
      state() { return { selecting, capturing, regionForCompose }; }
    };
  `, context);
  return { api: context.api, events, shortcuts };
}

test('another double Shift during selection captures around the cursor', async () => {
  const { api, events } = harness();
  api.startSelect();
  await api.onHotkey();
  const rect = events.find(e => e[0] === 'captured')[1];
  assert.deepEqual(JSON.parse(JSON.stringify(rect)), { x: 400, y: 200, w: 400, h: 400 });
  assert.equal(events.find(e => e[0] === 'open')[1].cropPng.toString(), 'png');
  assert.equal(api.state().selecting, false);
});

test('Escape returns to the composer and clears the attachment capture state', () => {
  const { api, events, shortcuts } = harness();
  api.fromComposer();
  shortcuts.get('Escape')();
  assert.equal(api.state().selecting, false);
  assert.equal(api.state().regionForCompose, false);
  assert.ok(events.some(e => e[0] === 'show'));
  assert.equal(shortcuts.has('Escape'), false);
});

test('region capture adds a PNG to the existing composer', async () => {
  const { api, events } = harness();
  api.fromComposer();
  await api.completeSelection({ x: 10, y: 20, w: 200, h: 100 });
  assert.equal(events.filter(e => e[0] === 'compose-attach').length, 1);
  assert.equal(events.some(e => e[0] === 'open'), false);
  assert.ok(events.some(e => e[0] === 'show'));
});

test('failed capture restores the composer and permits retry', async () => {
  const { api, events } = harness(async () => { throw new Error('capture unavailable'); });
  api.fromComposer();
  await api.completeSelection({ x: 10, y: 20, w: 200, h: 100 });
  assert.equal(api.state().capturing, false);
  assert.equal(api.state().regionForCompose, false);
  assert.ok(events.some(e => e[0] === 'show'));
  assert.match(events.find(e => e[0] === 'toast')[1].text, /capture unavailable/);
  api.startSelect();
  assert.equal(api.state().selecting, true);
});

test('repeated input during capture does not duplicate screenshots or send tasks', async () => {
  let finish;
  let calls = 0;
  const { api, events } = harness(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  api.startSelect();
  const pending = api.onHotkey();
  await api.onHotkey();
  await api.completeSelection({ x: 0, y: 0, w: 50, h: 50 });
  assert.equal(calls, 1);
  finish({ toPNG: () => Buffer.from('png') });
  await pending;
  assert.equal(events.filter(e => e[0] === 'open').length, 1);
  assert.equal(events.some(e => e[0] === 'compose-send-now'), false);
});
