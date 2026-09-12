const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('../web/node_modules/typescript');
const { create } = require('../crew');

function loadProvider(fetch, env = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../web/lib/llm.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, process: { env: { LLM_BASE_URL: 'https://example.test/v1', LLM_API_KEY: 'test', LLM_MODEL: 'qwen3.8-27b', ...env } }, fetch, AbortSignal, console: { info() {} } });
  return exports;
}

test('malformed and empty model answers are errors, not negative classifications', async () => {
  for (const content of ['', 'no JSON', '{"propose":', '{"propose":"false"}', '{"propose":true}', '{"propose":true,"title":" "}']) {
    const provider = loadProvider(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) }));
    const result = await provider.propose('Prepare a summary', 'Notepad');
    assert.equal(result.propose, false);
    assert.ok(result.reason, content);
  }
});

test('real negative classification remains quiet', async () => {
  const provider = loadProvider(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"propose":false}' } }] }) }));
  const result = await provider.propose('Thanks!', 'Notepad');
  assert.equal(result.propose, false);
  assert.equal(result.reason, undefined);
});

test('Qwen requests allow later attachments and disable thinking', async () => {
  const provider = loadProvider(async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.chat_template_kwargs.enable_thinking, false);
    assert.match(body.messages[0].content, /AFTER accepting/);
    assert.ok(options.signal);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"propose":true,"title":"Prepare the summary by tomorrow"}' } }] }) };
  });
  const result = await provider.propose("I'll give you the summary by tommorow", 'Notepad');
  assert.equal(result.title, 'Prepare the summary by tomorrow');
});

test('invalid primary response falls through to the next provider', async () => {
  let calls = 0;
  const provider = loadProvider(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: ++calls === 1 ? '' : '{"propose":true,"title":"Prepare summary"}' } }] }) }), { OPENROUTER_API_KEY: 'test' });
  const result = await provider.propose('Prepare a summary', 'Notepad');
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.title, 'Prepare summary');
});

test('ready proposals reach the cursor pill', async () => {
  let proposal;
  const crew = create({ cfg: { proposer: 'local' }, log() {}, onToast() {}, onProposal(p) { proposal = p; } });
  crew.onField({ text: "I'll send the report tomorrow", app: 'Notepad' });
  await new Promise(resolve => setTimeout(resolve, 800));
  assert.equal(proposal.context, "I'll send the report tomorrow");
  assert.equal(crew.takeProposal().title, proposal.title);
});

test('late response reaches the composer despite reads from Crewboard', async () => {
  let late;
  const crew = create({ cfg: { proposer: 'local' }, log() {}, onToast() {}, onLateTitle(p) { late = p; } });
  const field = { text: "I'll give you the summary by tomorrow", app: 'Notepad' };
  crew.onField(field);
  crew.fromField(field);
  crew.onField({ text: "I'll edit the title here", app: 'Crewboard' });
  await new Promise(resolve => setTimeout(resolve, 800));
  assert.equal(late.context, field.text);
  assert.equal(crew.takeProposal(), null);
});

test('late title preserves a user edit in the composer', () => {
  const elements = new Map();
  const handlers = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', style: {}, focus() {}, addEventListener() {}, appendChild() {} });
    return elements.get(id);
  };
  const source = fs.readFileSync(path.join(__dirname, '../compose.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(source, {
    require: name => name === './file-drop' ? { installFileDrop() {} } : ({ ipcRenderer: { on: (event, handler) => handlers.set(event, handler), send() {} } }),
    document: { getElementById: element, querySelectorAll: () => [] }, window: { addEventListener() {} },
  });
  handlers.get('compose-open')(null, { title: 'Local title' });
  handlers.get('compose-title')(null, { title: 'Model title' });
  assert.equal(element('title').value, 'Model title');
  element('title').value = 'My own title';
  handlers.get('compose-title')(null, { title: 'Another model title' });
  assert.equal(element('title').value, 'My own title');
});
