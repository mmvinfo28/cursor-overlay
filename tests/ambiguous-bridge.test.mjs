import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bridgeTick } from '../web/lib/ambiguous-bridge.mjs';

function harness(ambiguous = null) {
  const task = { id: 'task-1', title: 'Prepare report', status: 'done', created_by: 'owner@example.test', result: { summary: 'Prepared', files: [{ name: 'report.md', url: 'https://example.test/report.md' }], ...(ambiguous ? { ambiguous } : {}) } };
  const state = { task, key: null, requests: [], query: '', failMessage: false, dbError: null };
  const db = { from(table) {
    let values, single = false, status;
    const q = {
      select() { return q; }, eq(k, v) { if (k === 'status') status = v; return q; },
      or(filter) { state.query = filter; return q; }, order() { return q; }, limit() { return q; },
      update(v) { values = v; return q; }, maybeSingle() { single = true; return q; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        if (state.dbError) return { error: { message: state.dbError } };
        if (values) { Object.assign(task, structuredClone(values)); return { data: null }; }
        if (table === 'profiles') return { data: single ? { user_id: 'user-1' } : [] };
        if (table === 'profile_secrets') return { data: state.key ? { ambiguous_agent_key: state.key } : null };
        const a = task.result.ambiguous;
        return { data: status === 'done' && (!a?.at || a?.skipped) ? [structuredClone(task)] : [] };
      }).then(resolve, reject); }
    };
    return q;
  } };
  const request = async (_key, method, path, body) => {
    state.requests.push({ method, path, body });
    if (path === '/api/documents') return { id: 'doc-1' };
    if (path === '/api/channels') return [{ id: 'channel-1', name: 'crewboard' }];
    if (state.failMessage) throw new Error('temporary messaging outage');
    return { id: 'message-1' };
  };
  return { state, run: () => bridgeTick(db, { request }) };
}

test('a task created before workspace provisioning remains eligible and delivers afterward', async () => {
  const { state, run } = harness();
  assert.equal((await run()).skipped, 1);
  assert.equal(state.task.result.ambiguous, undefined);
  state.key = 'test-provisioned';
  assert.deepEqual((await run()).delivered, ['Prepare report']);
  assert.ok(state.task.result.ambiguous.at);
  assert.equal(state.requests.filter(r => r.path === '/api/documents').length, 1);
  assert.match(state.requests.find(r => r.path.endsWith('/messages')).body.content, /report\.md/);
  assert.deepEqual((await run()).delivered, []);
});

test('legacy no-key skips are selected again after provisioning', async () => {
  const { state, run } = harness({ skipped: 'no key', at: '2026-09-12T10:00:00Z' });
  state.key = 'test-legacy';
  assert.deepEqual((await run()).delivered, ['Prepare report']);
  assert.match(state.query, /skipped\.not\.is\.null/);
  assert.equal(state.task.result.ambiguous.skipped, undefined);
});

test('retry after a message outage reuses the document already created', async () => {
  const { state, run } = harness();
  state.key = 'test-retry'; state.failMessage = true;
  assert.equal((await run()).errors.length, 1);
  assert.ok(state.task.result.ambiguous.doc);
  assert.equal(state.task.result.ambiguous.at, undefined);
  state.failMessage = false;
  assert.deepEqual((await run()).delivered, ['Prepare report']);
  assert.equal(state.requests.filter(r => r.path === '/api/documents').length, 1);
});

test('database failures are reported instead of a false successful empty scan', async () => {
  const { state, run } = harness(); state.dbError = 'database unavailable';
  await assert.rejects(run(), /database unavailable/);
  assert.equal(state.requests.length, 0);
});
