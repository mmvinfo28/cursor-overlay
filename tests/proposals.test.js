const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('../web/node_modules/typescript');
const { create } = require('../crew');

function loadProvider(fetch, env = {}, context = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../web/lib/llm.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, process: { env: { LLM_BASE_URL: 'https://example.test/v1', LLM_API_KEY: 'test', LLM_MODEL: 'qwen3.8-27b', ...env } }, fetch, AbortSignal, console: { info() {} }, ...context });
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
  let calls = 0;
  const provider = loadProvider(async () => {
    calls++;
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"propose":false}' } }] }) };
  }, { OPENROUTER_API_KEY: 'test' });
  const result = await provider.propose('Thanks!', 'Notepad');
  assert.equal(result.propose, false);
  assert.equal(result.reason, undefined);
  assert.equal(calls, 1);
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

test('invalid Qwen responses fall through all chat models before the next provider', async () => {
  const models = [];
  const provider = loadProvider(async (_url, options) => {
    models.push(JSON.parse(options.body).model);
    return { ok: true, json: async () => ({ choices: [{ message: { content: models.length <= 3 ? '' : '{"propose":true,"title":"Prepare summary"}' } }] }) };
  }, { OPENROUTER_API_KEY: 'test' });
  const result = await provider.propose('Prepare a summary', 'Notepad');
  assert.deepEqual(models, ['qwen3.8-27b', 'qwen3.8-27b-sglang', 'qwen3.8-27b-vision', 'openai/gpt-4o-mini']);
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.title, 'Prepare summary');
});

test('Qwen switches to its other chat backends after HTTP and timeout failures', async () => {
  const models = [];
  const provider = loadProvider(async (_url, options) => {
    models.push(JSON.parse(options.body).model);
    if (models.length === 1) return { ok: false, status: 503 };
    if (models.length === 2) throw new DOMException('The operation timed out', 'TimeoutError');
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"propose":true,"title":"Prepare summary"}' } }] }) };
  });
  const result = await provider.propose('Prepare a summary', 'Notepad');
  assert.deepEqual(models, ['qwen3.8-27b', 'qwen3.8-27b-sglang', 'qwen3.8-27b-vision']);
  assert.equal(result.provider, 'llm');
  assert.equal(result.model, 'qwen3.8-27b-vision');
  assert.equal(result.title, 'Prepare summary');
});

test('explicit chat model order excludes embeddings and duplicate candidates', async () => {
  const models = [];
  const provider = loadProvider(async (_url, options) => {
    models.push(JSON.parse(options.body).model);
    return { ok: false, status: 503 };
  }, { LLM_MODELS: ' qwen3.8-27b-sglang, qwen3-embeddings, qwen3.8-27b-vision, qwen3.8-27b-sglang ', LLM_FALLBACK_MODELS: 'should-not-be-used' });
  const result = await provider.propose('Prepare a summary', 'Notepad');
  assert.deepEqual(models, ['qwen3.8-27b-sglang', 'qwen3.8-27b-vision']);
  assert.match(result.reason, /llm\/qwen3\.8-27b-sglang HTTP 503/);
  assert.match(result.reason, /llm\/qwen3\.8-27b-vision HTTP 503/);
});

test('custom primary models use only explicitly configured fallbacks', async () => {
  for (const [env, expected] of [
    [{ LLM_MODEL: 'custom-chat' }, ['custom-chat']],
    [{ LLM_MODEL: 'custom-chat', LLM_FALLBACK_MODELS: ' other-chat, custom-chat, qwen3-embeddings ' }, ['custom-chat', 'other-chat']],
    [{ LLM_FALLBACK_MODELS: '' }, ['qwen3.8-27b']],
  ]) {
    const models = [];
    const provider = loadProvider(async (_url, options) => {
      models.push(JSON.parse(options.body).model);
      return { ok: false, status: 503 };
    }, env);
    await provider.propose('Prepare a summary', 'Notepad');
    assert.deepEqual(models, expected);
  }
});

test('slow primary attempts reserve time for every fallback within the desktop deadline', async () => {
  let now = 0;
  let attemptTimeout = 0;
  const budgets = [];
  const provider = loadProvider(async () => {
    now += attemptTimeout;
    throw new DOMException('The operation timed out', 'TimeoutError');
  }, {}, {
    Date: { now: () => now },
    AbortSignal: { timeout(ms) { attemptTimeout = ms; budgets.push(ms); return AbortSignal.abort(); } },
  });
  const result = await provider.propose('Prepare a summary', 'Notepad');
  assert.deepEqual(budgets, [4000, 4000, 4000]);
  assert.equal(now, 12000);
  assert.equal(result.propose, false);
  assert.match(result.reason, /qwen3\.8-27b-vision/);
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
