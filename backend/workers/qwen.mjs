// Node 22+: node --env-file=backend/.env.worker.local backend/workers/qwen.mjs
// Secrets stay on the server. This process only holds the worker trigger token.
import { setTimeout as delay } from 'node:timers/promises';
const url = process.env.WORKER_URL;
const token = process.env.WORKER_TOKEN;
if (!url || !token) throw new Error('WORKER_URL and WORKER_TOKEN are required');
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
let previous = '', failures = 0;
while (!stopping) {
  try {
    const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(310000) });
    if (!response.ok) throw new Error(`Worker HTTP ${response.status}`);
    const result = await response.json(); failures = 0;
    const line = JSON.stringify(result);
    if (line !== previous || result.task_id) console.log(new Date().toISOString(), line);
    previous = line;
  } catch (error) { failures++; console.error(new Date().toISOString(), error.message); }
  if (!stopping) await delay(Math.min(30000, 3000 * 2 ** Math.min(failures, 3)));
}
