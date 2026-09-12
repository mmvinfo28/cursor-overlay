import { auth0 } from "@/lib/auth0";
import { createClient } from "@/lib/supabase/server";

export type Viewer = { id: string; email: string; name: string; provider: "auth0" | "supabase" };

// Who is looking at the dashboard: an Auth0 session wins, else a Supabase session, else null.
export async function getViewer(): Promise<Viewer | null> {
  if (auth0) {
    const s = await auth0.getSession();
    if (s?.user) return { id: String(s.user.sub ?? s.user.email ?? ""), email: s.user.email ?? "", name: s.user.name ?? s.user.email ?? "", provider: "auth0" };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) return { id: user.id, email: user.email ?? "", name: (user.user_metadata?.full_name as string) || (user.user_metadata?.user_name as string) || user.email || user.id, provider: "supabase" };
  return null;
}
