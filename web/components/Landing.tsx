import Link from "next/link";

const REPO = "mmvinfo28/cursor-overlay";

type Release = { tag: string; exe?: string; dmgArm?: string; dmgX64?: string; size?: number };

// Latest installers from GitHub Releases (published by the release workflow). Cached 5 min.
async function latestRelease(): Promise<Release | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { next: { revalidate: 300 }, headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) return null;
    const j = await r.json();
    const assets: { name: string; browser_download_url: string; size: number }[] = j.assets ?? [];
    const find = (re: RegExp) => assets.find((a) => re.test(a.name));
    const exe = find(/\.exe$/);
    return { tag: j.tag_name, exe: exe?.browser_download_url, size: exe?.size, dmgArm: find(/arm64\.dmg$/)?.browser_download_url, dmgX64: find(/x64\.dmg$/)?.browser_download_url };
  } catch {
    return null;
  }
}

// A still of the product: the sentence being typed, the pill, the composer — all CSS, no screenshots to keep fresh.
function Demo() {
  return (
    <div className="surface relative overflow-hidden p-5 md:p-7 text-left">
      <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(500px 220px at 30% 0%, rgba(233,162,59,.12), transparent 70%)" }} />
      <div className="text-[11px] uppercase tracking-[.18em] text-dim mb-3">Slack · #finance</div>
      <div className="rounded-xl border border-line bg-[#0c0c0e] p-3 font-mono text-[13px] text-[#d6d6db]">
        <span>I&apos;ll get the Q3 numbers into a sheet by 5</span><span className="inline-block w-[2px] h-4 bg-amber align-middle ml-0.5 animate-pulse" />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-amber/60 bg-[#151517] px-3 py-1.5 text-[12px] font-semibold text-amber-2 shadow-[0_6px_20px_rgba(0,0,0,.35)]">
          <span className="ring !w-3 !h-3" />↯ Build the Q3 numbers sheet <span className="text-dim font-normal">· ⇧⇧ to send</span>
        </span>
      </div>
      <div className="mt-4 grid sm:grid-cols-[1fr_auto] gap-3 items-start">
        <div className="card p-3">
          <div className="text-[11px] text-dim mb-1.5">Create a task</div>
          <div className="text-sm font-semibold">Build the Q3 numbers sheet</div>
          <div className="text-xs text-[#b8b8bc] mt-1">Context: the CSV export from Drive, last quarter&apos;s sheet as a template.</div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <span className="chip">📎 q3-export.csv</span><span className="chip">🗂 finance/2025</span><span className="chip">🔗 drive.google.com/…</span>
          </div>
        </div>
        <div className="flex flex-col gap-2 min-w-[170px]">
          <div className="card p-2.5 flex items-center gap-2"><span className="avatar codex">C</span><div><div className="text-xs font-semibold">codex-1</div><div className="text-[11px] text-dim">on it · 12 s</div></div></div>
          <div className="card p-2.5 flex items-center gap-2"><span className="pill done">done</span><div className="text-[11px] text-dim">q3-numbers.xlsx → OneDrive</div></div>
        </div>
      </div>
    </div>
  );
}

export default async function Landing({ signedIn = false }: { signedIn?: boolean }) {
  const rel = await latestRelease();
  const mb = rel?.size ? ` · ${Math.round(rel.size / 1048576)} MB` : "";
  const releases = `https://github.com/${REPO}/releases/latest`;

  return (
    <div className="flex-1 flex flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-3 px-6 py-4 bg-[rgba(15,15,17,.7)] backdrop-blur border-b border-transparent">
        <span className="ring" />
        <span className="font-semibold tracking-tight">Crewboard</span>
        <nav className="ml-auto flex items-center gap-4 text-sm">
          <a href={releases} className="text-dim hover:text-white">Releases</a>
          <a href={`https://github.com/${REPO}`} className="text-dim hover:text-white">GitHub</a>
          <Link href={signedIn ? "/dashboard" : "/login"} className="btn">{signedIn ? "Open your board" : "Sign in"}</Link>
        </nav>
      </header>

      <main className="flex-1 px-6">
        <section className="max-w-6xl mx-auto grid lg:grid-cols-[1.05fr_1fr] gap-10 items-center pt-14 pb-14">
          <div className="text-center lg:text-left fade-in">
            <p className="text-amber text-[11px] font-bold tracking-[.22em] uppercase mb-4">AI Tinkerers Build Day</p>
            <h1 className="text-4xl md:text-[56px] font-semibold leading-[1.05] tracking-tight">Your crew,<br className="hidden md:block" /> at the cursor.</h1>
            <p className="text-dim text-lg mt-5 max-w-xl mx-auto lg:mx-0">
              Type a commitment in Slack, tap Shift twice. A team of AI agents does the work, and the result
              lands next to your cursor and in your files — no chat window in between.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start items-center">
              <a href={rel?.exe ?? releases} className="btn-primary text-base px-6 py-3">
                ⤓ Download for Windows{rel ? <span className="opacity-70 font-medium text-sm">&nbsp;{rel.tag}{mb}</span> : null}
              </a>
              {rel?.dmgArm || rel?.dmgX64 ? (
                <span className="flex gap-2">
                  {rel.dmgArm && <a href={rel.dmgArm} className="btn">Mac · Apple silicon</a>}
                  {rel.dmgX64 && <a href={rel.dmgX64} className="btn">Mac · Intel</a>}
                </span>
              ) : (
                <span className="btn opacity-60 cursor-default">Mac · coming soon</span>
              )}
            </div>
            <p className="text-xs text-dim mt-4">Windows 11 · updates itself · Mac build is a results viewer for now.</p>
          </div>
          <div className="fade-in" style={{ animationDelay: ".1s" }}><Demo /></div>
        </section>

        <section className="max-w-6xl mx-auto grid md:grid-cols-3 gap-4 pb-14">
          {[
            ["↯", "Capture", "The overlay reads the field you're typing in. A local filter spots promises and deadlines; a model names the task. Nothing leaves your machine until you double-tap."],
            ["⇧⇧", "Crew", "The composer takes the context: files, a folder, a screen region, your clipboard, a link. Workers claim the task by capability, split big ones, and ask you when stuck."],
            ["✓", "Results", "Done work shows as a toast at your cursor, in the Crewboard panel, and as real files in OneDrive or your desktop. Everything stays on the board."],
          ].map(([icon, t, d], i) => (
            <div key={t} className="surface p-5 fade-in" style={{ animationDelay: `${.1 + i * .06}s` }}>
              <div className="flex items-center gap-3 mb-3"><span className="avatar !w-9 !h-9 !text-base">{icon}</span><h2 className="font-semibold">{t}</h2></div>
              <p className="text-sm text-[#c8c8cc] leading-relaxed">{d}</p>
            </div>
          ))}
        </section>

        <section className="max-w-6xl mx-auto pb-20">
          <div className="surface p-6 grid md:grid-cols-[1fr_auto] gap-4 items-center" style={{ background: "linear-gradient(90deg, rgba(233,162,59,.08), transparent 60%), var(--color-panel)" }}>
            <div>
              <h2 className="font-semibold text-lg">The board</h2>
              <p className="text-sm text-dim mt-1">Every task, every worker, every result — live. Answer a worker&apos;s question from the board, the panel, or the copilot.</p>
            </div>
            <Link href={signedIn ? "/dashboard" : "/login"} className="btn-primary">{signedIn ? "Open your board" : "Sign in with GitHub"}</Link>
          </div>
        </section>
      </main>

      <footer className="px-6 py-5 text-xs text-dim border-t border-line flex flex-wrap gap-x-4 gap-y-1">
        <span>Built by 3 humans + 3 AIs, coordinated by the same tool.</span>
        <span className="ml-auto">OpenAI · OpenRouter · Supabase · Vercel · CopilotKit · Exa · Ambiguous</span>
      </footer>
    </div>
  );
}
