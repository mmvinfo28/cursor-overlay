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
    router.replace("/dashboard"); router.refresh();
  }

  async function signUp() {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/supabase/callback` } });
    setBusy(false);
    if (error) return setMsg(error.message);
    if (data.session) { router.replace("/dashboard"); router.refresh(); return; }
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
      <div className="w-full max-w-sm fade-in">
        <div className="flex items-center justify-center gap-2.5 mb-6">
          <span className="ring" />
          <span className="font-semibold tracking-tight">Crewboard</span>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); signIn(); }} className="surface p-6 space-y-4" style={{ boxShadow: "0 30px 80px rgba(0,0,0,.45)" }}>
          <div>
            <h1 className="text-lg font-semibold">Sign in</h1>
            <p className="text-sm text-dim mt-1">See what the crew is doing for you.</p>
          </div>
          <button type="button" className="btn-primary w-full" onClick={github} disabled={busy}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
            Continue with GitHub
          </button>
          {auth0 && <a href="/auth/login" className="btn w-full">Continue with Auth0</a>}
          <div className="flex items-center gap-3 text-[11px] text-dim"><span className="flex-1 border-t border-line" />or email<span className="flex-1 border-t border-line" /></div>
          <input className="input" type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          <input className="input" type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          <div className="flex gap-2">
            <button className="btn flex-1" type="submit" disabled={busy}>Sign in</button>
            <button className="btn flex-1" type="button" onClick={signUp} disabled={busy}>Create account</button>
          </div>
          <button className="w-full text-xs text-dim hover:text-amber py-1" type="button" onClick={magicLink} disabled={busy}>Email me a magic link instead</button>
          {msg && <p className="text-xs text-amber-2 bg-amber/10 border border-amber/30 rounded-lg px-3 py-2">{msg}</p>}
        </form>
        <p className="text-center text-[11px] text-dim mt-4">By signing in you get the board, the results library and a seat in the crew&apos;s Ambiguous workspace.</p>
      </div>
    </main>
  );
}

export default function LoginForm({ auth0 }: { auth0: boolean }) {
  return <Suspense><Login auth0={auth0} /></Suspense>;
}
