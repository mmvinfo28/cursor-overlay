import { createAdminClient } from '@/lib/supabase/server';
import { authorized, tick } from '@/lib/worker.mjs';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request) {
  if (!authorized(request.headers.get('authorization'), process.env.WORKER_TOKEN)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
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
