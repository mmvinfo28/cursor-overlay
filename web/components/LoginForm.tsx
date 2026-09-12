"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function Login({ auth0 }: { auth0: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(params.get("error") === "link" ? "That link expired. Try again." : null);
  const [busy, setBusy] = useState(false);
  const supabase = createClient();

  async function signIn() {
    setBusy(true); setMsg(null);
    if (!password) return setMsg("Type your password, or use GitHub / the magic link.");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setMsg(error.message.includes("Invalid login") ? "No account with that email + password. New here? Create account, or get a magic link." : error.message);
    router.replace("/"); router.refresh();
  }

  async function signUp() {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/supabase/callback` } });
    setBusy(false);
    if (error) return setMsg(error.message);
    if (data.session) { router.replace("/"); router.refresh(); return; }
    setMsg("Account created. Open the confirmation email, then come back and sign in.");
  }

  async function github() {
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.signInWithOAuth({ provider: "github", options: { redirectTo: `${location.origin}/supabase/callback` } });
    if (error) { setBusy(false); setMsg(error.message); }
  }

  async function magicLink() {
    if (!email) return setMsg("Email first.");
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/supabase/callback` } });
    setBusy(false);
    setMsg(error ? error.message : "Magic link sent. Check your inbox.");
  }

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <form onSubmit={(e) => { e.preventDefault(); signIn(); }} className="w-full max-w-sm rounded-2xl border border-line bg-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <span className="ring" />
          <h1 className="text-lg font-semibold">Crewboard</h1>
        </div>
        <p className="text-sm text-dim">Sign in to see what the crew is doing for you.</p>
        <button type="button" className="btn-primary w-full" onClick={github} disabled={busy}>Continue with GitHub</button>
        {auth0 && <a href="/auth/login" className="btn block text-center">Continue with Auth0</a>}
        <div className="flex items-center gap-3 text-[11px] text-dim"><span className="flex-1 border-t border-line" />or email<span className="flex-1 border-t border-line" /></div>
        <input className="input" type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        <input className="input" type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <div className="flex gap-2">
          <button className="btn flex-1" type="submit" disabled={busy}>Sign in</button>
          <button className="btn flex-1" type="button" onClick={signUp} disabled={busy}>Create account</button>
        </div>
        <button className="btn w-full" type="button" onClick={magicLink} disabled={busy}>Email me a magic link (no password)</button>
        {msg && <p className="text-xs text-amber">{msg}</p>}
      </form>
    </main>
  );
}

export default function LoginForm({ auth0 }: { auth0: boolean }) {
  return <Suspense><Login auth0={auth0} /></Suspense>;
}
