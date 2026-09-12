"use client";
// A 60-second scripted product tour — the same seven chapters as the prototype video, built as live DOM
// so it stays in sync with the product. Auto-plays; click a chapter, ← → to move, space to pause.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

type Chapter = { key: string; label: string; secs: number; render: (p: number) => React.ReactNode };

const ease = (x: number) => Math.min(1, Math.max(0, x));
const at = (p: number, from: number, to = 1) => ease((p - from) / (to - from));   // 0→1 between two points of the chapter
const Reveal = ({ on, children, className = "", delay = 0 }: { on: boolean; children: React.ReactNode; className?: string; delay?: number }) => (
  <div className={`transition-all duration-500 ${on ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"} ${className}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>
);
const Caption = ({ text }: { text: string }) => (
  <p key={text} className="text-xs text-dim mt-4 fade-in"><span className="text-amber">—</span> {text}</p>
);

// ---------- scenes ----------
function Idea({ p }: { p: number }) {
  return (
    <div className="grid lg:grid-cols-[1fr_.8fr] gap-10 items-center h-full">
      <div>
        <Reveal on={p > 0.05}><p className="text-amber text-[11px] font-bold tracking-[.22em] uppercase mb-5">From a passing thought</p></Reveal>
        <Reveal on={p > 0.15}><h1 className="text-5xl md:text-6xl font-semibold tracking-tight leading-[1.05]">You say it.</h1></Reveal>
        <Reveal on={p > 0.35}><h1 className="text-5xl md:text-6xl font-semibold tracking-tight leading-[1.05] text-amber-2">The crew does it.</h1></Reveal>
        <Reveal on={p > 0.55}><p className="text-dim mt-5 max-w-md">Turn everyday commitments<br />into work you can delegate.</p></Reveal>
      </div>
      <div className="relative h-56 hidden lg:block">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full border-[6px] border-amber/80 shadow-[0_0_60px_rgba(233,162,59,.25)]" style={{ transform: `translate(-50%,-50%) scale(${0.6 + 0.4 * at(p, 0.1, 0.5)})`, opacity: at(p, 0.1, 0.4) }} />
        <div className="absolute left-1/2 top-1/2 card px-3 py-2 text-xs text-[#d6d6db] whitespace-nowrap" style={{ transform: `translate(${-40 + 90 * at(p, 0.4, 0.9)}px, ${20 - 60 * at(p, 0.4, 0.9)}px) rotate(-8deg)`, opacity: at(p, 0.45, 0.7) * (1 - at(p, 0.9, 1)) }}>“I’ll compare the quotes…”</div>
      </div>
    </div>
  );
}

const TYPED = "I'll compare these three supplier quotes and send a recommendation by tomorrow.";
function Detect({ p }: { p: number }) {
  const typed = TYPED.slice(0, Math.floor(TYPED.length * at(p, 0.15, 0.6)));
  const pill = p > 0.72;
  return (
    <div className="h-full flex flex-col">
      <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">It starts with a promise.</h1>
      <p className="text-dim mt-1.5">Keep working in the app you already use.</p>
      <div className="surface mt-5 flex-1 grid grid-cols-[170px_1fr] overflow-hidden text-[12px] max-h-[380px]">
        <aside className="bg-[#101012] border-r border-line p-3">
          <div className="font-semibold text-sm mb-3">Studio workspace</div>
          <div className="text-[10px] uppercase tracking-wider text-dim mb-1">Channels</div>
          {["general", "procurement", "design", "team-updates"].map((c) => <div key={c} className={`px-2 py-1 rounded-md ${c === "procurement" ? "bg-card-2 text-white" : "text-dim"}`}># {c}</div>)}
          <div className="text-[10px] uppercase tracking-wider text-dim mt-3 mb-1">Direct messages</div>
          <div className="px-2 py-1 text-dim">• Maya Chen</div>
        </aside>
        <div className="p-4 flex flex-col">
          <div className="flex items-center gap-2 border-b border-line pb-2 mb-3"><span className="font-semibold"># procurement</span><span className="text-dim">supplier selection</span></div>
          <div className="flex gap-2.5">
            <span className="avatar human !w-7 !h-7 !text-[11px]">MC</span>
            <div>
              <div><span className="font-semibold">Maya Chen</span> <span className="text-dim">10:41</span></div>
              <div className="mt-0.5 text-[#d6d6db]">The three quotes are in. Can you compare them for the office?<br />Budget €12,000. Delivery within three weeks.</div>
              <div className="flex gap-1.5 mt-2">{["Aurora.pdf", "Nexa.pdf", "Vertex.pdf"].map((f) => <span key={f} className="chip">📄 {f}</span>)}</div>
            </div>
          </div>
          <div className="mt-auto relative">
            <div className="rounded-lg border border-line bg-[#0c0c0e] px-3 py-2.5 font-mono text-[12px] min-h-[40px]">
              <span className="text-dim">Message #procurement</span>{typed ? <span className="absolute left-3 top-2.5 bg-[#0c0c0e] pr-2 text-[#e8e8ea]">{typed}<span className="inline-block w-[2px] h-3.5 bg-amber align-middle ml-0.5 animate-pulse" /></span> : null}
            </div>
            <div className={`absolute -top-9 left-2 transition-all duration-500 ${pill ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}`}>
              <span className="inline-flex items-center gap-2 rounded-full border border-amber/70 bg-[#151517] px-3 py-1.5 text-[12px] font-semibold text-amber-2 shadow-[0_8px_24px_rgba(0,0,0,.45)]"><span className="ring !w-3 !h-3" />↯ Compare three supplier quotes <span className="text-dim font-normal">· ⇧⇧ to send</span></span>
            </div>
          </div>
        </div>
      </div>
      <Caption text={p < 0.72 ? "An actionable commitment becomes a quiet suggestion." : "Nothing is sent until you confirm."} />
    </div>
  );
}

function Confirm({ p }: { p: number }) {
  const files = ["Aurora.pdf", "Nexa.pdf", "Vertex.pdf"];
  const shown = Math.floor(3 * at(p, 0.25, 0.6));
  const sent = p > 0.85;
  return (
    <div className="h-full flex flex-col">
      <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Your context. Your confirmation.</h1>
      <p className="text-dim mt-1.5">Review the request and attach the source material.</p>
      <div className="grid md:grid-cols-[.9fr_1.1fr] gap-5 mt-5 flex-1 items-center">
        <Reveal on={p > 0.1} className="surface p-5">
          <p className="text-amber text-[10px] font-bold tracking-[.2em] uppercase mb-3">You stay in control</p>
          <p className="text-lg font-semibold leading-snug">Review the task.<br />Add the evidence.<br />Send when ready.</p>
          <p className="text-xs text-dim mt-3">Files, screenshots, links,<br />or the text already in focus.</p>
        </Reveal>
        <Reveal on={p > 0.05} className={`surface p-4 text-[12px] transition-transform ${sent ? "scale-[.98] opacity-70" : ""}`}>
          <div className="flex items-center gap-2 mb-3"><span className="ring !w-3 !h-3" /><span className="font-semibold">Create a task</span><span className="text-dim">from Slack</span><span className="ml-auto text-dim">✕</span></div>
          <div className="input font-semibold !py-2">Compare three supplier quotes</div>
          <div className="text-[10px] text-dim mt-2">Context</div>
          <div className="input !py-2 mt-1 text-[#d6d6db] min-h-[52px]">I&apos;ll compare these three supplier quotes and send a recommendation by tomorrow.<br />Budget €12,000 · delivery within three weeks.</div>
          <div className="text-[10px] text-dim mt-2">Add context from</div>
          <div className="flex flex-wrap gap-1.5 mt-1">{["📎 File", "🗂 Folder", "✂ Screen region", "📷 Around cursor", "📋 Clipboard", "🪟 This field", "🔗 Link"].map((b, i) => <span key={b} className={`chip ${i === 0 && p > 0.2 && p < 0.3 ? "!border-amber" : ""}`}>{b}</span>)}</div>
          <div className="flex flex-wrap gap-1.5 mt-2 min-h-[26px]">{files.slice(0, shown).map((f) => <span key={f} className="chip fade-in">📄 {f} <b className="text-dim font-normal">· 210 KB</b></span>)}</div>
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line"><span className="text-dim text-[11px]"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> or <kbd>⇧⇧</kbd> send</span><span className="ml-auto btn !py-1 !px-2.5 !text-[11px]">Cancel</span><span className={`btn-primary !py-1 !px-3 !text-[11px] ${sent ? "!bg-ok" : ""}`}>{sent ? "Sent ✓" : "Send to crew"}</span></div>
        </Reveal>
      </div>
      <Caption text={sent ? "Approved. The task is sent to your crew." : "Nothing is sent until you confirm."} />
    </div>
  );
}

function Delegate({ p }: { p: number }) {
  const claimed = p > 0.4;
  return (
    <div className="h-full flex flex-col">
      <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">One request. A shared task.</h1>
      <p className="text-dim mt-1.5">The task moves onto Crewboard, with all its context attached.</p>
      <Reveal on={p > 0.05} className="surface mt-5 p-3 text-[11px] flex-1 max-h-[360px] overflow-hidden">
        <div className="flex items-center gap-3 mb-3"><span className="ring !w-3 !h-3" /><span className="font-semibold text-xs">Crewboard</span><span className="text-dim">Board · Insights · Results</span><span className="ml-auto text-dim">● live</span></div>
        <div className="grid grid-cols-[1fr_1fr_1fr_1fr_150px] gap-2">
          {[["Open", claimed ? 0 : 1], ["Working", claimed ? 1 : 0], ["Needs you", 0], ["Done", 0]].map(([l, n]) => (
            <div key={String(l)} className="rounded-lg border border-line bg-[#111113] min-h-[190px]">
              <div className="col-head !py-1.5 !px-2 !text-[9px]">{l}<span className="n">{n}</span></div>
              {n ? (
                <div className={`card m-1.5 p-2 ${claimed ? "working" : ""}`}>
                  <div className="flex gap-1.5 items-start"><b className="flex-1 text-[11px] leading-tight">Compare three supplier quotes</b><span className={`pill ${claimed ? "running" : "open"} !text-[9px] !px-1.5`}>{claimed ? "running" : "open"}</span></div>
                  <div className="text-dim mt-1 text-[10px]">{claimed ? "Extractor" : "waiting for a worker"} · Slack · just now</div>
                  <div className="text-[#b8b8bc] mt-1 text-[10px]">Budget €12,000 · Delivery within 21 days</div>
                  <div className="flex flex-wrap gap-1 mt-1.5">{["Aurora.pdf", "Nexa.pdf", "Vertex.pdf"].map((f) => <span key={f} className="chip !px-1.5 !py-0.5 !text-[9px]">📄 {f}</span>)}</div>
                </div>
              ) : <div className="empty !py-8"><span className="glyph !w-6 !h-6" /></div>}
            </div>
          ))}
          <div className="rounded-lg border border-line bg-[#111113]">
            <div className="col-head !py-1.5 !px-2 !text-[9px]">Workers<span className="n">3</span></div>
            {[["Extractor", "read", claimed], ["Analyst", "compare", false], ["Writer", "write", false]].map(([n, k, busy]) => (
              <div key={String(n)} className="card m-1.5 p-1.5 flex items-center gap-2"><span className={`avatar !w-5 !h-5 !text-[9px] ${busy ? "" : "human"}`}>{String(n).charAt(0)}</span><div><div className="font-semibold text-[10px]">{n}</div><div className="text-dim text-[9px]">{busy ? "working" : "idle"} · {k}</div></div></div>
            ))}
          </div>
        </div>
      </Reveal>
      <Caption text={claimed ? "A worker picks it up. You can follow the status on the board." : "Everything you attached travels with the task."} />
    </div>
  );
}

function Crew({ p }: { p: number }) {
  const s1 = at(p, 0.05, 0.35), s2 = at(p, 0.35, 0.65), s3 = at(p, 0.65, 0.95);
  const status = (s: number) => (s >= 1 ? "done" : s > 0 ? "running" : "queued");
  const Agent = ({ n, name, task, s, children }: { n: string; name: string; task: string; s: number; children: React.ReactNode }) => (
    <div className={`surface p-3.5 text-[11px] transition-all duration-500 ${s > 0 ? "opacity-100" : "opacity-50"}`}>
      <div className="flex items-center gap-2"><span className="tag !text-[10px]">{n}</span><span className="font-semibold text-sm">{name}</span><span className={`ml-auto pill ${status(s) === "done" ? "done" : status(s) === "running" ? "running" : ""} !text-[9px] !px-1.5`}>{status(s)}</span></div>
      <div className="mt-2 text-xs">{task}</div>
      <div className="h-[2px] mt-2 mb-3 bg-line rounded"><div className="h-full rounded bg-amber transition-[width] duration-700" style={{ width: `${s * 100}%` }} /></div>
      {children}
    </div>
  );
  const check = (s: number, i: number) => <span className={`ml-auto ${at(s, i / 3, (i + 1) / 3) >= 1 ? "text-ok" : "text-dim"}`}>{at(s, i / 3, (i + 1) / 3) >= 1 ? "✓" : "·"}</span>;
  return (
    <div className="h-full flex flex-col">
      <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">A crew, working toward one result.</h1>
      <p className="text-dim mt-1.5">Read the sources. Evaluate the trade-offs. Produce a recommendation.</p>
      <div className="flex items-center gap-2 mt-4 text-[11px]"><span className="ring !w-3 !h-3" /><span>Compare three supplier quotes</span><span className="text-dim">/</span><span className="text-amber-2">Illustrative execution breakdown · timing compressed</span></div>
      <div className="grid md:grid-cols-[1fr_auto_1fr_auto_1fr] gap-3 items-center mt-3 flex-1">
        <Agent n="01" name="Extractor" task="Read the evidence" s={s1}>
          {["Aurora.pdf", "Nexa.pdf", "Vertex.pdf"].map((f, i) => <div key={f} className="flex items-center gap-2 py-1 border-t border-line/70"><span>📄</span>{f}{check(s1, i)}</div>)}
        </Agent>
        <span className="text-dim hidden md:block">→</span>
        <Agent n="02" name="Analyst" task="Compare the options" s={s2}>
          {[["Budget ceiling", "€12,000"], ["Delivery deadline", "21 days"], ["Best fit", s2 > 0.8 ? "Nexa · €11,200" : "…"]].map(([k, v]) => <div key={k} className="flex py-1 border-t border-line/70"><span className="text-dim">{k}</span><span className={`ml-auto ${k === "Best fit" && s2 > 0.8 ? "text-ok font-semibold" : ""}`}>{v}</span></div>)}
        </Agent>
        <span className="text-dim hidden md:block">→</span>
        <Agent n="03" name="Writer" task="Prepare the result" s={s3}>
          <div className={`card p-2 flex items-center gap-2 transition-opacity ${s3 > 0.3 ? "opacity-100" : "opacity-40"}`}><span className="text-ok">📄</span><div><div className="font-semibold">Supplier-comparison.pdf</div><div className="text-dim text-[10px]">Recommendation + source evidence</div></div></div>
          <div className="text-dim mt-2 text-[10px]">Comparison table<br />Rationale and next step</div>
        </Agent>
      </div>
      <Caption text={p < 0.5 ? "Extracting price, lead time and warranty from three quotes." : "Turning the comparison into a clear, usable report."} />
      <p className="text-[10px] text-dim mt-1">Simulated agent execution, using fictional supplier quotes.</p>
    </div>
  );
}

function Deliver({ p }: { p: number }) {
  return (
    <div className="h-full flex flex-col">
      <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">The result comes back to you.</h1>
      <p className="text-dim mt-1.5">A recommendation, the evidence, and a file you can use.</p>
      <div className="grid md:grid-cols-[260px_1fr] gap-4 mt-5 flex-1 items-start">
        <Reveal on={p > 0.05} className="surface p-3 text-[11px]">
          <div className="flex items-center gap-2"><span className="ring !w-3 !h-3" /><span className="font-semibold text-sm">Crewboard</span><span className="ml-auto text-dim">⊞ ✕</span></div>
          <div className="flex gap-3 mt-3 border-b border-line pb-1.5"><span className="text-dim">Tasks</span><span className="text-white font-semibold border-b-2 border-amber -mb-[7px] pb-1.5">Results <span className="tag !text-[9px]">1</span></span></div>
          <div className="text-[9px] uppercase tracking-wider text-dim mt-3 mb-1.5">Today</div>
          <div className="card p-2.5">
            <div className="flex items-center"><span className="pill done !text-[9px] !px-1.5">done</span><span className="ml-auto text-dim text-[10px]">just now</span></div>
            <div className="font-semibold mt-1.5 text-xs">Compare three supplier quotes</div>
            <div className="text-dim mt-1 text-[10px]">3 quotes reviewed.<br />Recommendation and report ready.</div>
            <div className="chip mt-2 w-full !justify-start !border-amber/50 !bg-[rgba(233,162,59,.08)]">📄 <span><b>Supplier-comparison.pdf</b><br /><span className="text-dim text-[9px]">PDF document · 1 page</span></span><span className="ml-auto text-amber">→</span></div>
          </div>
          <div className="text-dim mt-3 text-[10px]">📁 Results folder →</div>
        </Reveal>
        <Reveal on={p > 0.25} className="rounded-xl bg-[#f6f6f4] text-[#1c1c1f] p-5 text-[12px] shadow-[0_30px_80px_rgba(0,0,0,.5)]">
          <div className="flex items-center gap-2 text-[10px] text-[#777] mb-3"><span>📄 Supplier-comparison.pdf</span><span className="ml-auto">1 / 1 · 100%</span></div>
          <div className="flex items-start"><div><div className="text-lg font-semibold">Supplier comparison</div><div className="text-[#666] text-[11px]">Office procurement · Budget €12,000 · Delivery within 21 days</div></div><span className="ml-auto text-[9px] border border-[#e0d3b5] bg-[#fbf3df] text-[#8a6412] px-2 py-0.5 rounded">Sample data</span></div>
          <div className="mt-3 flex items-center gap-3 rounded-lg border border-[#cfe9d8] bg-[#eef8f1] p-3"><span className="w-6 h-6 rounded-full bg-[#2f9e5a] text-white grid place-items-center text-xs">✓</span><div><div className="font-semibold">Recommend Nexa</div><div className="text-[#555] text-[11px]">Meets both requirements, with the longest warranty.</div></div><div className="ml-auto text-right"><div className="font-semibold text-base">€11,200</div><div className="text-[#777] text-[10px]">€800 under budget</div></div></div>
          <table className="w-full mt-3 text-[11px]">
            <thead><tr className="text-[#888] text-[10px]"><th className="text-left font-medium py-1">Supplier</th><th className="text-left font-medium">Total quote</th><th className="text-left font-medium">Delivery</th><th className="text-left font-medium">Warranty</th><th className="text-left font-medium">Requirements</th></tr></thead>
            <tbody>
              {[["Aurora", "€12,800", "21 days", "3 years", "Over budget", ""], ["Nexa", "€11,200", "14 days", "5 years", "✓ Meets both", "font-semibold"], ["Vertex", "€11,950", "35 days", "3 years", "Too late", ""]].map(([s, q, d, w, r, cls]) => (
                <tr key={s} className={`border-t border-[#e6e6e2] ${cls}`}><td className="py-1.5">{s}</td><td>{q}</td><td>{d}</td><td>{w}</td><td className={r.startsWith("✓") ? "text-[#2f9e5a]" : "text-[#b06a2a]"}>{r}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 border-l-2 border-amber pl-2 text-[11px]"><b>€1,600 lower than Aurora.</b> <span className="text-[#666]">Quoted delivery: 7 days before deadline.</span></div>
        </Reveal>
      </div>
      <Caption text="Saved to your results folder. Ready for your decision." />
    </div>
  );
}

function End({ p }: { p: number }) {
  return (
    <div className="grid lg:grid-cols-[1fr_.7fr] gap-10 items-center h-full">
      <div>
        <Reveal on={p > 0.05}><h1 className="text-5xl md:text-6xl font-semibold tracking-tight text-amber-2 leading-[1.05]">Your intent.</h1></Reveal>
        <Reveal on={p > 0.25}><h1 className="text-5xl md:text-6xl font-semibold tracking-tight leading-[1.05]">The crew takes<br />it from here.</h1></Reveal>
        <Reveal on={p > 0.5}><p className="text-dim mt-6 text-sm">{["Capture", "Confirm", "Delegate", "Deliver"].map((s, i) => <span key={s}><span className={i === 3 ? "text-amber-2" : ""}>{s}</span>{i < 3 ? <span className="mx-2">→</span> : null}</span>)}</p></Reveal>
        <Reveal on={p > 0.7} className="mt-8 flex gap-3"><Link href="/login" className="btn-primary">Open your board</Link><Link href="/" className="btn">Download the app</Link></Reveal>
      </div>
      <div className="hidden lg:flex flex-col items-center gap-4">
        <div className="w-40 h-40 rounded-full border-[10px] border-amber shadow-[0_0_80px_rgba(233,162,59,.3)]" style={{ transform: `scale(${0.7 + 0.3 * at(p, 0, 0.5)})`, opacity: at(p, 0, 0.3) }} />
        <div className="font-semibold">Crewboard</div>
      </div>
    </div>
  );
}

const CHAPTERS: Chapter[] = [
  { key: "idea", label: "The idea", secs: 6, render: (p) => <Idea p={p} /> },
  { key: "detect", label: "Detect", secs: 11, render: (p) => <Detect p={p} /> },
  { key: "confirm", label: "Confirm", secs: 10, render: (p) => <Confirm p={p} /> },
  { key: "delegate", label: "Delegate", secs: 7, render: (p) => <Delegate p={p} /> },
  { key: "crew", label: "The crew", secs: 12, render: (p) => <Crew p={p} /> },
  { key: "deliver", label: "Deliver", secs: 9, render: (p) => <Deliver p={p} /> },
  { key: "end", label: "Crewboard", secs: 6, render: (p) => <End p={p} /> },
];
const TOTAL = CHAPTERS.reduce((s, c) => s + c.secs, 0);

export default function Walkthrough() {
  const [i, setI] = useState(0);
  const [p, setP] = useState(0);            // progress within the chapter 0..1
  const [paused, setPaused] = useState(false);
  const startRef = useRef<number>(0);
  const pausedAt = useRef<number>(0);

  const go = useCallback((n: number, keepPlaying = true) => {
    const idx = ((n % CHAPTERS.length) + CHAPTERS.length) % CHAPTERS.length;
    setI(idx); setP(0); startRef.current = performance.now(); pausedAt.current = 0;
    if (keepPlaying) setPaused(false);
  }, []);

  useEffect(() => {
    startRef.current = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      if (!paused) {
        const el = (now - startRef.current) / 1000;
        const secs = CHAPTERS[i].secs;
        if (el >= secs) { go(i + 1); } else setP(el / secs);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, paused]);

  // pause keeps the elapsed time; resume continues from it
  useEffect(() => {
    if (paused) pausedAt.current = performance.now();
    else if (pausedAt.current) { startRef.current += performance.now() - pausedAt.current; pausedAt.current = 0; }
  }, [paused]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === "ArrowRight") go(i + 1);
      if (e.key === "ArrowLeft") go(i - 1);
      if (e.key === " ") { e.preventDefault(); setPaused((x) => !x); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, go]);

  const elapsedBefore = CHAPTERS.slice(0, i).reduce((s, c) => s + c.secs, 0);
  const clock = Math.floor(elapsedBefore + p * CHAPTERS[i].secs);

  return (
    <div className="flex-1 flex flex-col min-h-screen select-none">
      <header className="flex items-center gap-3 px-6 py-4">
        <Link href="/" className="flex items-center gap-2"><span className="ring" /><span className="font-semibold tracking-tight">Crewboard</span></Link>
        <span className="text-dim">/</span><span className="text-[11px] tracking-[.18em] uppercase text-dim">Prototype walkthrough</span>
        <span className="ml-auto inline-flex items-center gap-2 text-[11px] text-amber-2 border border-amber/40 bg-amber/10 rounded-full px-3 py-1"><span className="w-1.5 h-1.5 rounded-full bg-amber" />Agent execution simulated</span>
      </header>

      <main className="flex-1 px-6 md:px-10 py-4 max-w-6xl w-full mx-auto min-h-[560px]">
        <div key={CHAPTERS[i].key} className="h-full fade-in">{CHAPTERS[i].render(p)}</div>
      </main>

      <footer className="px-6 md:px-10 pb-6 pt-2 max-w-6xl w-full mx-auto">
        <div className="grid gap-2" style={{ gridTemplateColumns: CHAPTERS.map((c) => `${c.secs}fr`).join(" ") }}>
          {CHAPTERS.map((c, k) => (
            <button key={c.key} onClick={() => go(k)} className="text-left group">
              <div className="h-[2px] rounded bg-line overflow-hidden"><div className="h-full bg-amber transition-[width] duration-200" style={{ width: k < i ? "100%" : k === i ? `${p * 100}%` : "0%" }} /></div>
              <div className={`mt-2 text-[10px] tracking-[.14em] uppercase ${k === i ? "text-amber-2" : "text-dim group-hover:text-white"}`}>{c.label}</div>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 mt-3 text-[11px] text-dim">
          <span className="tabular-nums">{String(Math.floor(clock / 60)).padStart(2, "0")}:{String(clock % 60).padStart(2, "0")} / {String(Math.floor(TOTAL / 60)).padStart(2, "0")}:{String(TOTAL % 60).padStart(2, "0")}</span>
          <button className="hover:text-white" onClick={() => setPaused((x) => !x)}>{paused ? "▶ play" : "❚❚ pause"}</button>
          <span className="hidden sm:inline">← → chapters · space pause · click a chapter to jump</span>
          <Link href="/login" className="ml-auto hover:text-amber">Open the real board →</Link>
        </div>
      </footer>
    </div>
  );
}
