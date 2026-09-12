import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import { getViewer } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ago, TASK_SELECT, type Task, type Worker } from "@/lib/types";
import { costByTask, eventLine, fmtDuration, medianTimeToDone, throughput, workerLoad, type EventRow } from "@/lib/stats";

export const dynamic = "force-dynamic";

// Two-series categorical palette, validated for the dark surface (OKLCH band, CVD ΔE 25, contrast ≥ 3:1).
const C_CREATED = "#C47F22";
const C_DONE = "#6E92E6";

export default async function Insights() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const supabase = await createClient();

  const [t, w, e] = await Promise.all([
    supabase.from("tasks").select(TASK_SELECT).order("created_at", { ascending: false }).limit(500),
    supabase.from("workers").select("*").order("last_seen", { ascending: false }),
    supabase.from("events").select("*,task:tasks(title)").order("at", { ascending: false }).limit(40),
  ]);
  const tasks = (t.data ?? []) as unknown as Task[];
  const workers = (w.data ?? []) as Worker[];
  const events = (e.data ?? []) as unknown as EventRow[];
  const workerName = (id: string | null) => workers.find((x) => x.id === id)?.name ?? null;

  const done = tasks.filter((x) => x.status === "done").length;
  const open = tasks.filter((x) => x.status === "open").length;
  const working = tasks.filter((x) => x.status === "claimed" || x.status === "running").length;
  const ask = tasks.filter((x) => x.status === "needs-human").length;
  const cost = tasks.reduce((s, x) => s + (x.events || []).reduce((a, ev) => a + Number(ev.cost_usd || 0), 0), 0);
  const online = workers.filter((x) => x.status !== "dead" && Date.now() - new Date(x.last_seen).getTime() < 60000).length;
  const hours = throughput(tasks);
  const hmax = Math.max(1, ...hours.map((h) => Math.max(h.created, h.done)));
  const costs = costByTask(tasks);
  const cmax = Math.max(0.0001, ...costs.map((c) => c.cost));
  const load = workerLoad(tasks, workers);
  const lmax = Math.max(1, ...load.map((l) => l.done));

  return (
    <Shell viewer={viewer} active="insights">
      <div className="fade-in flex flex-col gap-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Insights</h1>
            <p className="text-sm text-dim mt-0.5">How the crew is doing — throughput, cost, load, and what happened last.</p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <div className="stat"><b>{tasks.length}</b><span>tasks</span></div>
            <div className="stat"><b>{done}</b><span>done</span></div>
            <div className="stat"><b>{working}</b><span>in flight</span></div>
            <div className="stat"><b className={ask ? "!text-ask" : ""}>{ask}</b><span>need you</span></div>
            <div className="stat"><b>{online}<span className="text-dim text-sm">/{workers.length}</span></b><span>workers</span></div>
            <div className="stat"><b>${cost.toFixed(3)}</b><span>spent</span></div>
            <div className="stat"><b>{fmtDuration(medianTimeToDone(tasks))}</b><span>median to done</span></div>
          </div>
        </div>

        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4 items-start">
          {/* Throughput — created vs done per hour */}
          <section className="surface p-4">
            <div className="flex items-center gap-3 mb-3">
              <h2 className="font-semibold text-sm">Tasks per hour</h2>
              <span className="text-[11px] text-dim">last 12 h</span>
              <div className="ml-auto flex items-center gap-4 text-[11px] text-dim">
                <span className="inline-flex items-center gap-1.5"><i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: C_CREATED }} />created</span>
                <span className="inline-flex items-center gap-1.5"><i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: C_DONE }} />done</span>
              </div>
            </div>
            <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${hours.length}, 1fr)` }}>
              {hours.map((h) => (
                <div key={h.start} className="flex flex-col items-center gap-1" title={`${h.label} — ${h.created} created, ${h.done} done`}>
                  <div className="h-28 w-full flex items-end justify-center gap-[2px]">
                    <div className="w-2/5 rounded-t-[4px] transition-[height]" style={{ height: `${(h.created / hmax) * 100}%`, background: C_CREATED, minHeight: h.created ? 4 : 0 }} />
                    <div className="w-2/5 rounded-t-[4px] transition-[height]" style={{ height: `${(h.done / hmax) * 100}%`, background: C_DONE, minHeight: h.done ? 4 : 0 }} />
                  </div>
                  <div className="text-[10px] text-dim tabular-nums">{h.label.slice(0, 2)}</div>
                </div>
              ))}
            </div>
            {tasks.length === 0 && <p className="text-xs text-dim mt-2">No tasks yet — the chart fills as the crew works.</p>}
          </section>

          {/* Worker load */}
          <section className="surface p-4">
            <div className="flex items-center gap-3 mb-3"><h2 className="font-semibold text-sm">Workers</h2><span className="text-[11px] text-dim">tasks done · in flight</span></div>
            <ul className="flex flex-col gap-2.5">
              {load.map((l) => (
                <li key={l.id} className="flex items-center gap-3" title={`${l.name}: ${l.done} done, ${l.active} in flight`}>
                  <span className={`avatar ${(l.kind || "").toLowerCase()} !w-7 !h-7 !text-[11px]`}>{l.name.charAt(0).toUpperCase()}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs"><span className="font-semibold truncate">{l.name}</span><span className={`live-dot ${l.alive ? "" : "off"} !w-1.5 !h-1.5`} /><span className="text-dim">{l.kind}</span><span className="ml-auto tabular-nums text-dim">{l.done}{l.active ? <span className="text-amber-2"> +{l.active}</span> : null}</span></div>
                    <div className="h-1.5 mt-1.5 rounded-full bg-[#121214] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(l.done / lmax) * 100}%`, background: C_CREATED }} /></div>
                  </div>
                </li>
              ))}
              {load.length === 0 && <li className="empty py-8"><span className="glyph" />No workers connected.</li>}
            </ul>
          </section>

          {/* Cost per task */}
          <section className="surface p-4">
            <div className="flex items-center gap-3 mb-3"><h2 className="font-semibold text-sm">Cost per task</h2><span className="text-[11px] text-dim">top {costs.length} · USD</span><span className="ml-auto text-xs text-dim tabular-nums">total ${cost.toFixed(3)}</span></div>
            <ul className="flex flex-col gap-2">
              {costs.map((c) => (
                <li key={c.id} className="grid grid-cols-[1fr_auto] gap-x-3 items-center text-xs" title={`${c.title}: $${c.cost.toFixed(4)}`}>
                  <span className="truncate">{c.title}</span>
                  <span className="tabular-nums text-dim">${c.cost.toFixed(3)}</span>
                  <div className="col-span-2 h-1.5 rounded-full bg-[#121214] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(c.cost / cmax) * 100}%`, background: C_CREATED }} /></div>
                </li>
              ))}
              {costs.length === 0 && <li className="empty py-8"><span className="glyph" />No spend recorded yet.</li>}
            </ul>
          </section>

          {/* Activity */}
          <section className="surface p-4">
            <div className="flex items-center gap-3 mb-3"><h2 className="font-semibold text-sm">Activity</h2><span className="text-[11px] text-dim">last {events.length} events</span></div>
            <ol className="flex flex-col">
              {events.map((ev) => {
                const { icon, text } = eventLine(ev);
                const tone = ev.kind === "done" ? "text-ok" : ev.kind === "needs-human" ? "text-ask" : ev.kind === "failed" ? "text-bad" : "text-amber-2";
                return (
                  <li key={ev.id} className="grid grid-cols-[18px_1fr_auto] gap-x-2.5 py-2 border-b border-line/70 last:border-0 text-xs items-start">
                    <span className={`font-mono ${tone}`}>{icon}</span>
                    <div className="min-w-0">
                      <div className="truncate"><span className="font-semibold">{ev.task?.title ?? "task"}</span>{workerName(ev.worker_id) ? <span className="text-dim"> · {workerName(ev.worker_id)}</span> : null}</div>
                      <div className="text-dim truncate">{text}</div>
                    </div>
                    <span className="text-dim tabular-nums whitespace-nowrap">{ago(ev.at)}</span>
                  </li>
                );
              })}
              {events.length === 0 && <li className="empty py-8"><span className="glyph" />Nothing happened yet.</li>}
            </ol>
          </section>
        </div>

        <p className="text-[11px] text-dim">Open {open} · in flight {working} · needs you {ask} · done {done}. Refresh for fresh numbers; the board itself is live.</p>
      </div>
    </Shell>
  );
}
