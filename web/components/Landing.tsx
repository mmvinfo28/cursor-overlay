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

export default async function Landing() {
  const rel = await latestRelease();
  const mb = rel?.size ? ` · ${Math.round(rel.size / 1048576)} MB` : "";
  const releases = `https://github.com/${REPO}/releases/latest`;

  return (
    <div className="flex-1 flex flex-col">
      <header className="flex items-center gap-3 px-6 py-4">
        <span className="ring" />
        <span className="font-semibold">Crewboard</span>
        <nav className="ml-auto flex items-center gap-4 text-sm">
          <a href={releases} className="text-dim hover:text-white">Releases</a>
          <a href={`https://github.com/${REPO}`} className="text-dim hover:text-white">GitHub</a>
          <Link href="/login" className="btn">Open dashboard</Link>
        </nav>
      </header>

      <main className="flex-1 px-6">
        <section className="max-w-3xl mx-auto pt-16 pb-12 text-center">
          <p className="text-amber text-xs font-semibold tracking-[.2em] uppercase mb-4">AI Tinkerers Build Day</p>
          <h1 className="text-4xl md:text-5xl font-semibold leading-tight">Your crew, at the cursor.</h1>
          <p className="text-dim text-lg mt-5 max-w-xl mx-auto">
            Type a commitment in Slack, tap Shift twice. A team of AI agents does the work and the result
            lands next to your cursor and in your files — no chat window in between.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center items-center">
            <a href={rel?.exe ?? releases} className="btn-primary text-base px-6 py-3">
              Download for Windows{rel ? ` · ${rel.tag}${mb}` : ""}
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
          <p className="text-xs text-dim mt-4">
            Windows 11 · updates itself · Mac build is a results viewer for now (capture helpers are Windows-only).
          </p>
        </section>

        <section className="max-w-4xl mx-auto grid md:grid-cols-3 gap-4 pb-16">
          {[
            ["1 · Capture", "The overlay reads the field you're typing in. A local filter spots dates, files and promises; a model decides if there's a task worth proposing."],
            ["2 · Crew", "Double-tap Shift sends it to the board. Codex, Claude and OpenRouter workers claim tasks by capability, split big ones, ask you when stuck."],
            ["3 · Results", "Done work shows up as a toast at your cursor, in the Crewboard panel, and as real files in OneDrive or your desktop. Everything stays on the board."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-xl border border-line bg-card p-5">
              <h2 className="font-semibold text-amber mb-2">{t}</h2>
              <p className="text-sm text-[#c8c8cc]">{d}</p>
            </div>
          ))}
        </section>

        <section className="max-w-4xl mx-auto pb-20">
          <div className="rounded-xl border border-line bg-[#111113] p-5 grid md:grid-cols-[1fr_auto] gap-4 items-center">
            <div>
              <h2 className="font-semibold">The dashboard</h2>
              <p className="text-sm text-dim mt-1">Every task, every worker, every result, live. Answer a worker's question from the board or from the desktop panel.</p>
            </div>
            <Link href="/login" className="btn-primary">Sign in</Link>
          </div>
        </section>
      </main>

      <footer className="px-6 py-5 text-xs text-dim border-t border-line flex flex-wrap gap-x-4 gap-y-1">
        <span>Built by 3 humans + 3 AIs, coordinated by the same tool.</span>
        <span className="ml-auto">OpenAI · OpenRouter · Supabase · Vercel · Exa · Ambiguous</span>
      </footer>
    </div>
  );
}
