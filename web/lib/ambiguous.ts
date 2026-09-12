// Every Crewboard user gets a seat in the team's Ambiguous workspace and a personal AI coworker.
// Runs server-side on the first dashboard visit after sign-up (and retries quietly later if something failed).
// Needs on Vercel: AMBIGUOUS_ADMIN_KEY (an owner/admin key from https://app.ambiguous.ai/developers),
// optional AMBIGUOUS_BASE (default https://app.ambiguous.ai), plus SUPABASE_SERVICE_ROLE_KEY.
import { createAdminClient } from "@/lib/supabase/server";
import type { Viewer } from "@/lib/session";

export type AmbiguousState = {
  status: "unconfigured" | "invited" | "ready" | "error";
  invite_url?: string; invited_at?: string;
  agent_user_id?: string; agent_name?: string; agent_email?: string; provisioned_at?: string;
  error?: string; tried_at?: string;
};

const BASE = (process.env.AMBIGUOUS_BASE || "https://app.ambiguous.ai").replace(/\/$/, "");
const RETRY_MS = 10 * 60 * 1000;

async function ambi(method: string, path: string, body?: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.AMBIGUOUS_ADMIN_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12_000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 160)}`);
  try { return JSON.parse(text); } catch { return {}; }
}

const firstName = (v: Viewer) => (v.name || v.email || "").split(/[@\s]/)[0].replace(/[^\w-]/g, "") || "Crew";

// Returns the user's Ambiguous state; provisions on first call. Never throws — the board must render regardless.
export async function ensureAmbiguous(viewer: Viewer): Promise<AmbiguousState> {
  const admin = createAdminClient();
  if (!admin || !viewer.id) return { status: "unconfigured", error: "no service role" };

  const { data: existing } = await admin.from("profiles").select("ambiguous").eq("user_id", viewer.id).maybeSingle();
  const cur = (existing?.ambiguous ?? {}) as AmbiguousState;
  if (cur.status === "ready") return cur;
  if (!process.env.AMBIGUOUS_ADMIN_KEY) {
    const st: AmbiguousState = { ...cur, status: "unconfigured", error: "AMBIGUOUS_ADMIN_KEY not set" };
    await admin.from("profiles").upsert({ user_id: viewer.id, email: viewer.email, name: viewer.name, ambiguous: st });
    return st;
  }
  if (cur.tried_at && Date.now() - new Date(cur.tried_at).getTime() < RETRY_MS && cur.status === "error") return cur;

  const st: AmbiguousState = { ...cur, tried_at: new Date().toISOString() };
  let agentKey: string | null = null;
  try {
    // 1. a seat for the human: per-recipient invite, Ambiguous emails them
    if (!st.invited_at && viewer.email) {
      const inv = await ambi("POST", "/api/admin/workspace/invite", { email: viewer.email, role: "member" });
      st.invite_url = inv.invite_url ?? inv.url ?? inv.invites?.[0]?.invite_url ?? inv.data?.invite_url;
      st.invited_at = new Date().toISOString();
      st.status = "invited";
    }
    // 2. their own AI coworker: an agent account whose key we keep server-side
    if (!st.agent_user_id) {
      const name = `${firstName(viewer)}'s crew`;
      const out = await ambi("POST", "/api/admin/users/provision-agent", { display_name: name, role: "member" });
      const user = out.user ?? out.data?.user ?? out;
      st.agent_user_id = user?.id; st.agent_name = user?.display_name ?? name; st.agent_email = user?.email;
      st.provisioned_at = new Date().toISOString();
      agentKey = out.api_key ?? out.data?.api_key ?? null;
    }
    st.status = "ready"; delete st.error;
  } catch (e) {
    st.status = st.status === "invited" ? "invited" : "error";
    st.error = (e as Error).message;
  }
  await admin.from("profiles").upsert({ user_id: viewer.id, email: viewer.email, name: viewer.name, ambiguous: st });
  if (agentKey) await admin.from("profile_secrets").upsert({ user_id: viewer.id, ambiguous_agent_key: agentKey });
  return st;
}

export const ambiguousBase = () => BASE;
