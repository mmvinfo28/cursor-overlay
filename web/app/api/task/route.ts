import { NextResponse } from "next/server";
import { createClient as createAnon } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";

// Called by the desktop overlay (no browser session). Creates a task, optionally with a screenshot crop.
// Body: { title, context?, source_app?, crop_base64?, created_by? }
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.title) return NextResponse.json({ error: "title required" }, { status: 400 });

  const admin = createAdminClient();
  const db = admin ?? createAnon(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

  let crop_url: string | null = null;
  if (body.crop_base64 && admin) {
    const path = `${Date.now()}.png`;
    const { error } = await admin.storage.from("crops").upload(path, Buffer.from(body.crop_base64, "base64"), { contentType: "image/png" });
    if (!error) crop_url = admin.storage.from("crops").getPublicUrl(path).data.publicUrl;
  }

  const { data, error } = await db
    .from("tasks")
    .insert({ title: String(body.title).slice(0, 120), context: body.context ?? null, source_app: body.source_app ?? null, crop_url, created_by: body.created_by ?? "overlay" })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id, crop_url });
}
