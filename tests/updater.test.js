const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('a downloaded update waits for capture completion before restarting', () => {
  const timers = [];
  const listeners = new Map();
  const installs = [];
  const app = {
    isPackaged: true, getPath: () => __dirname,
    requestSingleInstanceLock: () => true, on() {}, whenReady: () => ({ then() {} }),
  };
  const updater = {
    on: (name, fn) => listeners.set(name, fn),
    quitAndInstall: (...args) => installs.push(args),
  };
  const context = vm.createContext({
    require: name => name === 'electron' ? { app, ipcMain: { on() {} } }
      : name === 'electron-updater' ? { autoUpdater: updater }
      : name === 'fs' ? { appendFileSync() {} }
      : name.startsWith('./') ? {} : require(name),
    __dirname: path.join(__dirname, '..'), process, console,
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); }, setInterval() {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8') + `
    log = () => {};
    toastAtCursor = () => {};
    startUpdater();
    capturing = true;
    globalThis.finishCapture = () => { capturing = false; };
  `, context);
  listeners.get('update-downloaded')({ version: '0.1.99' });
  timers.find(timer => timer.delay === 15000).fn();
  assert.equal(installs.length, 0);
  assert.notEqual(app.quitting, true);
  context.finishCapture();
  timers.at(-1).fn();
  assert.deepEqual(installs, [[true, true]]);
  assert.equal(app.quitting, true);
});
