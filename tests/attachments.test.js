const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { installFileDrop } = require('../file-drop');

test('file drop resolves native paths, deduplicates and blocks navigation', async () => {
  const handlers = {}, classes = new Set(), calls = [];
  const document = { body: { classList: { add: x => classes.add(x), remove: x => classes.delete(x) } }, addEventListener: (name, handler) => { handlers[name] = handler; } };
  installFileDrop(document, paths => calls.push(paths), error => { throw error; }, { getPathForFile: file => file.nativePath });
  let prevented = 0;
  const event = { preventDefault: () => prevented++, dataTransfer: { types: ['Files'], files: [{ nativePath: 'C:/a.pdf' }, { nativePath: 'C:/a.pdf' }] } };
  handlers.dragenter(event); assert.equal(classes.has('file-drag'), true);
  handlers.drop(event); assert.equal(classes.size, 0);
  assert.deepEqual(calls, [['C:/a.pdf']]);
  handlers.drop({ preventDefault: () => prevented++, dataTransfer: { types: ['text/uri-list'], files: [] } });
  assert.equal(calls.length, 1); assert.equal(prevented, 3);
});

function mainHarness({ size = 12, readFile = async () => Buffer.from('file content') } = {}) {
  const messages = [];
  const context = vm.createContext({
    require: name => name === 'electron' ? {
      app: { isPackaged: false, requestSingleInstanceLock: () => true, on() {}, whenReady: () => ({ then() {} }) }, ipcMain: { on() {} },
      screen: { getCursorScreenPoint: () => ({ x: 50, y: 50 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    } : name === 'electron-updater' ? {} : name === 'fs' ? { appendFileSync() {}, promises: { stat: async () => ({ size, isFile: () => true }), readFile } } : name.startsWith('./') ? {} : require(name),
    __dirname: path.join(__dirname, '..'), process, console, Buffer, setTimeout, clearTimeout, messages,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8') + `
    log=()=>{};
    compose={show(){},focus(){},getSize(){return [480,520]},setPosition(){},isVisible(){return false},webContents:{send:(...args)=>messages.push(args)}};
    pendingTask={app:'Crewboard',context:'user context'}; composing=true;
    globalThis.api={attachFiles,composeFromFeed,cancel:closeCompose,newDraft(){pendingTask={app:'Crewboard'}},state(){return pendingTask}};
  `, context);
  return { api: context.api, messages };
}

test('dropped files are loaded into the draft without sending or replacing it', async () => {
  const { api, messages } = mainHarness();
  const draft = api.state();
  const result = await api.composeFromFeed({ title: 'new title', paths: [path.resolve('source.pdf')] });
  assert.equal(result.opened, false); assert.equal(api.state(), draft);
  const attachment = messages.find(m => m[0] === 'compose-attach')[1];
  assert.equal(attachment.mime, 'application/pdf'); assert.equal(Buffer.from(attachment.base64, 'base64').toString(), 'file content');
  assert.equal(messages.at(-1)[0], 'compose-busy'); assert.equal(messages.at(-1)[1], false);
});

test('Add opens an editable draft even when the helper title is empty', async () => {
  const { api, messages } = mainHarness();
  api.cancel();
  const result = await api.composeFromFeed({ title: '', paths: [] });
  assert.equal(result.opened, true);
  const opened = messages.find(m => m[0] === 'compose-open')[1];
  assert.equal(opened.title, ''); assert.equal(opened.context, ''); assert.equal(opened.app, 'Crewboard');
});

test('a cancelled attachment read never lands in a later draft', async () => {
  let finish;
  const { api, messages } = mainHarness({ readFile: () => new Promise(resolve => { finish = resolve; }) });
  const loading = api.attachFiles([path.resolve('source.pdf')]);
  await new Promise(resolve => setImmediate(resolve));
  api.cancel(); api.newDraft(); finish(Buffer.from('old draft file')); await loading;
  assert.equal(messages.some(m => m[0] === 'compose-attach'), false);
});

test('oversized file gives an actionable error and clears the loading lock', async () => {
  const { api, messages } = mainHarness({ size: 26 * 1024 * 1024 });
  await api.attachFiles([path.resolve('large.pdf')]);
  assert.equal(messages.some(m => m[0] === 'compose-attach'), false);
  assert.match(messages.find(m => m[0] === 'compose-error')[1], /25 MB/);
  assert.equal(api.state().loading, 0);
});

test('failed upload aborts task creation instead of silently omitting the source', async () => {
  const requests = [];
  const context = vm.createContext({ module: { exports: {} }, require: name => name === './llm' ? {} : require(name), Buffer, console, setTimeout, clearTimeout,
    fetch: async url => { requests.push(url); return { ok: false, status: 503, text: async () => 'unavailable' }; },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../crew.js'), 'utf8'), context);
  const crew = context.module.exports.create({ cfg: { supabaseUrl: 'https://source.test', anonKey: 'test' }, log() {}, onToast() {} });
  await assert.rejects(crew.send({ title: 'Summarize', attachments: [{ name: 'report.pdf', base64: 'cGRm' }] }), /report.pdf/);
  assert.equal(requests.length, 1); assert.ok(requests[0].includes('/storage/'));
});
