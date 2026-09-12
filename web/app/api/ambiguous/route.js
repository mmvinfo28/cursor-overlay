import { createAdminClient } from '@/lib/supabase/server';
import { bridgeTick } from '@/lib/ambiguous-bridge.mjs';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Vercel cron (every minute, see vercel.json) — also POST-able with the worker token for a manual run.
function allowed(request) {
  const auth = request.headers.get('authorization') || '';
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  if (process.env.WORKER_TOKEN && auth === `Bearer ${process.env.WORKER_TOKEN}`) return true;
  return false;
}

async function run(request) {
  if (!allowed(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const db = createAdminClient();
  if (!db) return Response.json({ error: 'service role not configured' }, { status: 503 });
  try { return Response.json(await bridgeTick(db)); }
  catch (error) { console.error('[ambiguous]', error.message); return Response.json({ error: error.message }, { status: 500 }); }
}
export const GET = run;
export const POST = run;
