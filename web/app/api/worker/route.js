import { createAdminClient } from '@/lib/supabase/server';
import { authorized, tick } from '@/lib/worker.mjs';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request) {
  const header = request.headers.get('authorization');
  if (!authorized(header, process.env.WORKER_TOKEN) && !authorized(header, process.env.CRON_SECRET)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const db = createAdminClient();
  if (!db) return Response.json({ error: 'Worker database is not configured' }, { status: 503 });
  try {
    const result = await tick(db, {
      workerId: process.env.QWEN_WORKER_ID,
      env: process.env,
      extractPdf: async bytes => {
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: bytes, isEvalSupported: false });
        try { return (await parser.getText()).text; } finally { await parser.destroy(); }
      },
    });
    return Response.json(result);
  } catch (error) {
    console.error('[worker]', error.message);
    return Response.json({ error: 'Worker invocation failed; check server logs' }, { status: 500 });
  }
}

// Vercel cron keeps the queue moving even when the desktop/pinger is closed.
export const GET = POST;
