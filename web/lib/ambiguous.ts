// Every Crewboard user gets Ambiguous at sign-up. Runs server-side on the first dashboard visit
// (retries quietly later if something failed). Two paths, picked by env:
//   default  — Path B, public `POST /api/auth/signup-agent`: a provisional workspace of their own, a coworker
//              ("<Name>'s crew") with an agent key we keep server-side, and a claim email to the user.
//   team     — if AMBIGUOUS_ADMIN_KEY is set: invite the email into the team workspace + provision the coworker there.
// Docs: https://app.ambiguous.ai/developers
import { createAdminClient } from "@/lib/supabase/server";
import type { Viewer } from "@/lib/session";

export type AmbiguousState = {
  status: "unconfigured" | "invited" | "ready" | "error";
  mode?: "own" | "team";
  invite_url?: string; invited_at?: string;
  workspace_id?: string; workspace_name?: string; workspace_slug?: string; provisional?: boolean; claim_sent?: boolean;
  agent_user_id?: string; agent_name?: string; agent_email?: string; provisioned_at?: string;
  error?: string; tried_at?: string;
};

const BASE = (process.env.AMBIGUOUS_BASE || "https://app.ambiguous.ai").replace(/\/$/, "");
const RETRY_MS = 10 * 60 * 1000;

async function ambi(method: string, path: string, body?: unknown, key?: string) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 160)}`);
  try { return JSON.parse(text); } catch { return {}; }
}

const firstName = (v: Viewer) => (v.name || v.email || "").split(/[@\s]/)[0].replace(/[^\w-]/g, "") || "Crew";
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

// Returns the user's Ambiguous state; provisions on first call. Never throws — the board must render regardless.
export async function ensureAmbiguous(viewer: Viewer): Promise<AmbiguousState> {
  const admin = createAdminClient();
  if (!admin || !viewer.id || !viewer.email) return { status: "unconfigured", error: admin ? "no email on the account" : "no service role" };

  const { data: existing } = await admin.from("profiles").select("ambiguous").eq("user_id", viewer.id).maybeSingle();
  const cur = (existing?.ambiguous ?? {}) as AmbiguousState;
  if (cur.status === "ready") return cur;
  if (cur.tried_at && Date.now() - new Date(cur.tried_at).getTime() < RETRY_MS) return cur;

  const st: AmbiguousState = { ...cur, tried_at: new Date().toISOString() };
  let agentKey: string | null = null;
  const agentName = `${firstName(viewer)}'s crew`;
  try {
    if (process.env.AMBIGUOUS_ADMIN_KEY) {
      // team workspace: a seat for the human + a coworker next to them
      st.mode = "team";
      if (!st.invited_at) {
        const inv = await ambi("POST", "/api/admin/workspace/invite", { email: viewer.email, role: "member" }, process.env.AMBIGUOUS_ADMIN_KEY);
        st.invite_url = inv.invite_url ?? inv.url ?? inv.invites?.[0]?.invite_url;
        st.invited_at = new Date().toISOString();
      }
      if (!st.agent_user_id) {
        const out = await ambi("POST", "/api/admin/users/provision-agent", { display_name: agentName, role: "member" }, process.env.AMBIGUOUS_ADMIN_KEY);
        st.agent_user_id = out.user?.id; st.agent_name = out.user?.display_name ?? agentName; st.agent_email = out.user?.email;
        agentKey = out.api_key ?? null;
      }
    } else {
      // their own workspace, bootstrapped by the coworker itself (public endpoint); the user gets a claim email
      st.mode = "own";
      if (!st.agent_user_id) {
        const wsName = `${firstName(viewer)}'s Crewboard`;
        const out = await ambi("POST", "/api/auth/signup-agent", {
          agent_display_name: agentName, human_email: viewer.email, workspace_name: wsName,
          workspace_slug: `${slugify(firstName(viewer))}-crewboard-${viewer.id.slice(0, 6)}`,
        });
        agentKey = out.api_key ?? null;
        st.agent_user_id = out.agent?.id; st.agent_name = out.agent?.display_name ?? agentName; st.agent_email = out.agent?.workspace_email;
        st.workspace_id = out.workspace?.id; st.workspace_name = out.workspace?.name ?? wsName; st.workspace_slug = out.workspace?.slug;
        st.provisional = out.workspace?.provisional ?? true; st.claim_sent = out.human?.claim_token_sent ?? true;
        st.invited_at = new Date().toISOString();
      }
    }
    st.provisioned_at = st.provisioned_at ?? new Date().toISOString();
    st.status = "ready"; delete st.error;
  } catch (e) {
    st.status = st.invited_at ? "invited" : "error";
    st.error = (e as Error).message;
  }
  await admin.from("profiles").upsert({ user_id: viewer.id, email: viewer.email, name: viewer.name, ambiguous: st });
  if (agentKey) await admin.from("profile_secrets").upsert({ user_id: viewer.id, ambiguous_agent_key: agentKey });
  return st;
}

export const ambiguousBase = () => BASE;
