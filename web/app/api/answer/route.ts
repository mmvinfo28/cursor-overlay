import { NextResponse } from "next/server";
import { createClient as createAnon } from "@supabase/supabase-js";

// Body: { task_id, text, by? } → events row the waiting worker picks up
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.task_id || !body?.text) return NextResponse.json({ error: "task_id and text required" }, { status: 400 });
  const db = createAnon(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { error } = await db.from("events").insert({ task_id: body.task_id, kind: "human-answer", payload: { text: body.text, by: body.by ?? "overlay" } });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
