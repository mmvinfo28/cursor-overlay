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
    win = {
      setIgnoreMouseEvents: value => events.push(['ignore', value]),
      setFocusable: value => events.push(['focusable', value]),
      setAlwaysOnTop: (...args) => events.push(['top', ...args]),
      show: () => events.push(['overlay-show']), focus: () => events.push(['overlay-focus']),
      blur: () => events.push(['overlay-blur']), isDestroyed: () => false,
      webContents: { send: (...args) => events.push(args) }
    };
    compose = { show: () => events.push(['show']), focus() {}, webContents: { send: (...args) => events.push(args) } };
    crew = {};
    grabSelectedText = async () => { events.push(['clipboard-copy']); return 'Selected text in another app'; };
    captureRect = capture;
    toastAtCursor = toast => events.push(['toast', toast]);
    openCompose = payload => events.push(['open', payload]);
    lastField = { app: 'Notepad', text: 'Context' };
    globalThis.api = {
      startSelect, cancelSelect, completeSelection, onHotkey,
      proposal(visible) {
        taskLabelActive = visible;
        crew.takeProposal = () => { events.push(['take-proposal']); return { title: 'Old task', context: 'Promise', app: 'Notepad' }; };
      },
      fromComposer() { composing = true; regionForCompose = true; startSelect(); },
      state() { return { selecting, capturing, regionForCompose }; }
    };
  `, context);
  return { api: context.api, events, shortcuts };
}

test('double Shift captures from an app without a text signal and does not copy its selection', async () => {
  const { api, events } = harness();
  await api.onHotkey();
  assert.equal(api.state().selecting, true);
  assert.ok(events.some(e => e[0] === 'overlay-focus'));
  assert.equal(events.some(e => e[0] === 'clipboard-copy'), false);
  assert.equal(events.some(e => e[0] === 'open'), false);
});

test('an invisible pending proposal cannot replace screenshot capture', async () => {
  const { api, events } = harness();
  api.proposal(false);
  await api.onHotkey();
  assert.equal(api.state().selecting, true);
  assert.equal(events.some(e => e[0] === 'take-proposal'), false);
});

test('a visible proposal still opens its task composer', async () => {
  const { api, events } = harness();
  api.proposal(true);
  await api.onHotkey();
  assert.equal(events.find(e => e[0] === 'open')[1].title, 'Old task');
  assert.equal(api.state().selecting, false);
});

test('the overlay accepts focus only during screenshot selection', async () => {
  for (const finish of ['cancelSelect', 'completeSelection']) {
    const { api, events } = harness();
    api.startSelect();
    await api[finish]({ x: 10, y: 20, w: 200, h: 100 });
    assert.deepEqual(events.filter(e => e[0] === 'focusable').map(e => Array.from(e)), [['focusable', true], ['focusable', false]]);
    assert.deepEqual(events.filter(e => e[0] === 'ignore').map(e => Array.from(e)), [['ignore', false], ['ignore', true]]);
    assert.ok(events.findIndex(e => e[0] === 'overlay-blur') > events.findIndex(e => e[0] === 'overlay-focus'));
  }
});

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
