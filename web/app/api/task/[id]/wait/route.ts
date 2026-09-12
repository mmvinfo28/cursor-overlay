import { NextResponse } from "next/server";
import { createClient as createAnon } from "@supabase/supabase-js";

// Long-poll: resolves as soon as the task leaves open/claimed/running, or after 50 s with the current row.
export async function GET(_req: Request, ctx: RouteContext<"/api/task/[id]/wait">) {
  const { id } = await ctx.params;
  const db = createAnon(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const deadline = Date.now() + 50_000;
  for (;;) {
    const { data } = await db.from("tasks").select("id,status,result,updated_at,events(kind,payload,at)").eq("id", id).single();
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (!["open", "claimed", "running"].includes(data.status) || Date.now() > deadline) return NextResponse.json(data);
    await new Promise((r) => setTimeout(r, 1500));
  }
}
