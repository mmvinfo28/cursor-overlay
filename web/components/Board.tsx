"use client";
import { useEffect, useMemo, useState } from "react";
import { useCopilotReadable, useCopilotAction } from "@copilotkit/react-core";
import { createClient } from "@/lib/supabase/client";
import { ago, TASK_SELECT, type Task, type Worker } from "@/lib/types";

const COLUMNS: { key: string; label: string; statuses: Task["status"][] }[] = [
  { key: "open", label: "Open", statuses: ["open"] },
  { key: "working", label: "Working", statuses: ["claimed", "running"] },
  { key: "ask", label: "Needs you", statuses: ["needs-human"] },
  { key: "done", label: "Done", statuses: ["done", "failed"] },
];

export default function Board({ initialTasks, initialWorkers, user }: { initialTasks: Task[]; initialWorkers: Worker[]; user: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [workers, setWorkers] = useState<Worker[]>(initialWorkers);
  const [title, setTitle] = useState("");
  const [live, setLive] = useState(false);

  async function reload() {
    const [t, w] = await Promise.all([
      supabase.from("tasks").select(TASK_SELECT).order("created_at", { ascending: false }).limit(200),
      supabase.from("workers").select("*").order("last_seen", { ascending: false }),
    ]);
    if (t.data) setTasks(t.data as unknown as Task[]);
    if (w.data) setWorkers(w.data as Worker[]);
  }

  // Realtime on tasks/events/deliverables/workers → refetch (joins are cheaper than patching nested rows)
  useEffect(() => {
    const ch = supabase
      .channel("board")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "deliverables" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "workers" }, reload)
      .subscribe((s) => setLive(s === "SUBSCRIBED"));
    const t = setInterval(reload, 15000); // belt and braces
    return () => { supabase.removeChannel(ch); clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addTask() {
    const t = title.trim();
    if (!t) return;
    setTitle("");
    await supabase.from("tasks").insert({ title: t.slice(0, 120), context: t, source_app: "Crewboard web", created_by: user });
    reload();
  }

  async function answer(taskId: string, text: string) {
    if (!text.trim()) return;
    await supabase.from("events").insert({ task_id: taskId, kind: "human-answer", payload: { text, by: user } });
    reload();
  }

  const cost = tasks.reduce((s, t) => s + (t.events || []).reduce((a, e) => a + Number(e.cost_usd || 0), 0), 0);
  const doneToday = tasks.filter((t) => t.status === "done" && Date.now() - new Date(t.updated_at).getTime() < 86400e3).length;

  // --- CopilotKit: the sidebar sees exactly what the board sees ---
  useCopilotReadable({
    description: "Live Crewboard state: every task, its status, the worker on it, its deliverables, and spend so far.",
    value: {
      totalCostUsd: Number(cost.toFixed(4)),
      doneToday,
      workers: workers.map((w) => ({ name: w.name, kind: w.kind, status: w.status, capabilities: w.capabilities })),
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        capability: t.capability,
        worker: t.worker?.name ?? null,
        capturedFrom: t.source_app,
        deliverables: (t.deliverables || []).map((d) => ({ name: d.name, kind: d.kind, url: d.url })),
      })),
    },
  });

  // The copilot can unblock a needs-human task through the board's own answer path.
  useCopilotAction({
    name: "answerBlockedTask",
    description: "Reply to a task whose status is needs-human, so its worker can continue.",
    parameters: [
      { name: "taskId", type: "string", description: "id of the needs-human task" },
      { name: "text", type: "string", description: "the answer to give the worker" },
    ],
    handler: async ({ taskId, text }) => {
      await answer(String(taskId), String(text));
      return `answered ${taskId}`;
    },
  });


  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <input className="input max-w-xl" placeholder="What should the crew do?  (Enter)" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTask()} />
        <button className="btn-primary" onClick={addTask}>Add</button>
        <div className="ml-auto flex items-center gap-5 text-xs text-dim">
          <span><b className="text-white">{workers.filter((w) => w.status !== "dead" && Date.now() - new Date(w.last_seen).getTime() < 60000).length}</b> workers online</span>
          <span><b className="text-white">{doneToday}</b> done today</span>
          <span><b className="text-white">${cost.toFixed(3)}</b> spent</span>
          <span className={live ? "text-ok" : ""}>{live ? "● live" : "○ polling"}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr_1fr_220px] gap-3 items-start">
        {COLUMNS.map((c) => {
          const rows = tasks.filter((t) => c.statuses.includes(t.status));
          return (
            <section key={c.key} className="rounded-xl border border-line bg-[#111113] min-h-40">
              <h2 className="px-3 py-2 text-xs uppercase tracking-wide text-dim border-b border-line flex justify-between">{c.label}<span>{rows.length}</span></h2>
              <div className="p-2 flex flex-col gap-2">
                {rows.map((t) => <Card key={t.id} t={t} onAnswer={answer} />)}
                {rows.length === 0 && <p className="text-xs text-dim text-center py-6">—</p>}
              </div>
            </section>
          );
        })}
        <aside className="rounded-xl border border-line bg-[#111113]">
          <h2 className="px-3 py-2 text-xs uppercase tracking-wide text-dim border-b border-line">Workers</h2>
          <ul className="p-2 flex flex-col gap-1">
            {workers.map((w) => {
              const alive = w.status !== "dead" && Date.now() - new Date(w.last_seen).getTime() < 60000;
              return (
                <li key={w.id} className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg bg-card">
                  <span className={`w-2 h-2 rounded-full ${alive ? "bg-ok" : "bg-bad"}`} />
                  <span className="font-medium">{w.name}</span>
                  <span className="text-dim text-xs">{w.kind}</span>
                  <span className="ml-auto text-dim text-xs">{ago(w.last_seen)}</span>
                </li>
              );
            })}
            {workers.length === 0 && <li className="text-xs text-dim text-center py-6">no workers yet</li>}
          </ul>
        </aside>
      </div>
    </div>
  );
}

function Card({ t, onAnswer }: { t: Task; onAnswer: (id: string, text: string) => void }) {
  const [text, setText] = useState("");
  const dl = (t.deliverables || []).slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const summary = dl.find((d) => d.kind === "text");
  const files = dl.filter((d) => d.kind !== "text");
  const question = t.status === "needs-human" ? (t.events || []).filter((e) => e.kind === "needs-human").pop() : null;
  return (
    <article className="rounded-lg border border-line bg-card p-3">
      <div className="flex items-start gap-2">
        <h3 className="font-semibold text-sm flex-1 min-w-0 break-words">{t.title}</h3>
        <span className={`pill ${t.status}`}>{t.status}</span>
      </div>
      <p className="text-[11px] text-dim mt-1">{[t.worker?.name || (t.status === "open" ? "waiting for a worker" : ""), t.source_app, ago(t.created_at)].filter(Boolean).join(" · ")}</p>
      {t.context && t.context !== t.title && <p className="text-xs text-[#b8b8bc] mt-2 whitespace-pre-wrap break-words line-clamp-3">{t.context}</p>}
      {t.crop_url && <a href={t.crop_url} target="_blank" rel="noreferrer"><img src={t.crop_url} alt="" className="mt-2 rounded-md border border-line max-h-32 object-cover" /></a>}
      {summary && <p className="mt-2 p-2 rounded-md bg-[#111] border border-[#262628] text-xs whitespace-pre-wrap break-words">{summary.body}</p>}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {files.map((d) => (
            <a key={d.id} className="chip" href={d.url || "#"} target="_blank" rel="noreferrer">{d.kind === "pr" ? "🔀" : "📄"} <span className="truncate">{d.name}</span></a>
          ))}
        </div>
      )}
      {question && (
        <div className="mt-2 p-2 rounded-md border border-ask/40 bg-ask/10">
          <p className="text-xs text-[#cfe0ff] mb-1.5">{String((question.payload as { question?: string })?.question || "The worker needs your input.")}</p>
          <div className="flex gap-1.5">
            <input className="input text-xs" placeholder="Answer…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onAnswer(t.id, text); setText(""); } }} />
            <button className="btn text-xs" onClick={() => { onAnswer(t.id, text); setText(""); }}>Send</button>
          </div>
        </div>
      )}
    </article>
  );
}
