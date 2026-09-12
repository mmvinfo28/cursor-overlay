import { NextResponse } from "next/server";
import { propose } from "@/lib/llm";

// Body: { text, app } → { propose: boolean, title?: string, provider?: string, reason?: string }
// The overlay calls this after its local filter passes. Providers come from env (see lib/llm.ts);
// with none configured the overlay falls back to a local title.
export async function POST(request: Request) {
  const started = Date.now();
  const body = await request.json().catch(() => null);
  if (!body?.text) return NextResponse.json({ propose: false });
  const out = await propose(String(body.text).slice(0, 1500), String(body.app || "an app"));
  console.info("[propose:result]", { ms: Date.now() - started, propose: out.propose, provider: out.provider, reason: out.reason });
  return NextResponse.json(out);
}
