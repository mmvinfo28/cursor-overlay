"use client";
import { useEffect, useMemo, useState } from "react";
import { useCopilotReadable, useCopilotAction, useCopilotChatSuggestions, useCopilotAdditionalInstructions } from "@copilotkit/react-core";
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

  async function remove(taskId: string) {
    await supabase.from("tasks").delete().eq("id", taskId);
    reload();
  }

  async function answer(taskId: string, text: string) {
    if (!text.trim()) return;
    await supabase.from("events").insert({ task_id: taskId, kind: "human-answer", payload: { text, by: user } });
    reload();
  }

  const cost = tasks.reduce((s, t) => s + (t.events || []).reduce((a, e) => a + Number(e.cost_usd || 0), 0), 0);
  const doneToday = tasks.filter((t) => t.status === "done" && Date.now() - new Date(t.updated_at).getTime() < 86400e3).length;

  // Persona: a crew chief reporting status, not a generic assistant.
  useCopilotAdditionalInstructions({
    instructions:
      "You are the Crewboard copilot. You report on a live board of tasks worked by AI agents. " +
      "Be terse - one or two sentences unless asked for detail. Refer to tasks by title, never by id. " +
      "When a task needs a human answer, offer to send one. Never invent tasks, workers or costs: " +
      "if it is not in the board state you were given, say you do not see it.",
  });

  // Clickable starter prompts, so the board can be driven without typing.
  useCopilotChatSuggestions({
    instructions:
      "Suggest short questions about the current board: what is blocked, what shipped, " +
      "what the crew has spent, or which worker is busiest. Base them on the actual tasks present.",
    minSuggestions: 2,
    maxSuggestions: 3,
  });

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


  const online = workers.filter((w) => w.status !== "dead" && Date.now() - new Date(w.last_seen).getTime() < 60000).length;
  const dots: Record<string, string> = { open: "#c9c9cf", working: "var(--color-amber)", ask: "var(--color-ask)", done: "var(--color-ok)" };

  return (
    <div className="flex flex-col gap-4 fade-in">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px] max-w-2xl">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-dim text-sm">↯</span>
          <input className="input !pl-8" placeholder="What should the crew do?  (Enter)" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTask()} />
        </div>
        <button className="btn-primary" onClick={addTask}>Add task</button>
        <div className="ml-auto flex items-center gap-2">
          <div className="stat"><b>{online}</b><span>workers online</span></div>
          <div className="stat"><b>{doneToday}</b><span>done today</span></div>
          <div className="stat"><b>${cost.toFixed(3)}</b><span>spent</span></div>
          <div className="stat items-center" title={live ? "Realtime connected" : "Polling every 15 s"}>
            <span className="flex items-center gap-2"><span className={`live-dot ${live ? "" : "off"}`} /><b className="text-sm">{live ? "live" : "polling"}</b></span>
            <span>updates</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr_1fr_240px] gap-3 items-start">
        {COLUMNS.map((c) => {
          const rows = tasks.filter((t) => c.statuses.includes(t.status));
          return (
            <section key={c.key} className="surface min-h-48">
              <h2 className="col-head"><span className="dot" style={{ background: dots[c.key] }} />{c.label}<span className="n">{rows.length}</span></h2>
              <div className="p-2 flex flex-col gap-2">
                {rows.map((t) => <Card key={t.id} t={t} onAnswer={answer} onRemove={remove} />)}
                {rows.length === 0 && (
                  <div className="empty"><span className="glyph" />
                    {c.key === "open" ? "Type a commitment anywhere, double-tap Shift." : c.key === "working" ? "Nothing in flight." : c.key === "ask" ? "No questions from the crew." : "Nothing shipped yet."}
                  </div>
                )}
              </div>
            </section>
          );
        })}
        <aside className="surface">
          <h2 className="col-head"><span className="dot" style={{ background: "#8fb0ff" }} />Workers<span className="n">{online}/{workers.length}</span></h2>
          <ul className="p-2 flex flex-col gap-2">
            {workers.map((w) => <WorkerCard key={w.id} w={w} busy={tasks.filter((t) => t.worker_id === w.id && (t.status === "claimed" || t.status === "running")).length} />)}
            {workers.length === 0 && <li className="empty"><span className="glyph" />No workers connected.<span className="text-[11px]">Start one: <code className="text-[#c9c9cf]">backend/start-worker.ps1</code></span></li>}
          </ul>
        </aside>
      </div>
    </div>
  );
}

function WorkerCard({ w, busy }: { w: Worker; busy: number }) {
  const alive = w.status !== "dead" && Date.now() - new Date(w.last_seen).getTime() < 60000;
  const kind = (w.kind || "").toLowerCase();
  return (
    <li className={`card p-2.5 flex flex-col gap-2 ${alive ? "" : "opacity-60"}`}>
      <div className="flex items-center gap-2.5">
        <span className={`avatar ${kind}`}>{(w.name || "?").charAt(0).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><span className="font-semibold text-sm truncate">{w.name}</span><span className={`live-dot ${alive ? "" : "off"}`} /></div>
          <div className="text-[11px] text-dim">{w.kind} · {alive ? (busy ? `working on ${busy}` : "idle") : "offline"} · {ago(w.last_seen)}</div>
        </div>
      </div>
      {(w.capabilities || []).length > 0 && (
        <div className="flex flex-wrap gap-1">{w.capabilities.map((c) => <span key={c} className="tag">{c}</span>)}</div>
      )}
    </li>
  );
}

function Card({ t, onAnswer, onRemove }: { t: Task; onAnswer: (id: string, text: string) => void; onRemove: (id: string) => void }) {
  const [text, setText] = useState("");
  const dl = (t.deliverables || []).slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const summary = dl.find((d) => d.kind === "text");
  const files = dl.filter((d) => d.kind !== "text");
  const question = t.status === "needs-human" ? (t.events || []).filter((e) => e.kind === "needs-human").pop() : null;
  const mood = t.status === "needs-human" ? "ask" : t.status === "claimed" || t.status === "running" ? "working" : "";
  const workerKind = (t.worker?.kind || "").toLowerCase();
  return (
    <article className={`group card p-3 fade-in ${mood}`}>
      <div className="flex items-start gap-2">
        <h3 className="font-semibold text-sm flex-1 min-w-0 break-words leading-snug">{t.title}</h3>
        <span className={`pill ${t.status}`}>{t.status}</span>
        <button className="text-dim hover:text-bad opacity-0 group-hover:opacity-100 text-xs leading-none -mr-1 mt-0.5 transition-opacity" title="Remove task" onClick={() => onRemove(t.id)}>✕</button>
      </div>
      <div className="flex items-center gap-2 mt-1.5 text-[11px] text-dim">
        {t.worker
          ? <span className="inline-flex items-center gap-1.5"><span className={`avatar ${workerKind} !w-4 !h-4 !text-[9px]`}>{t.worker.name.charAt(0).toUpperCase()}</span>{t.worker.name}</span>
          : t.status === "open" ? <span>waiting for a worker</span> : null}
        {t.source_app && <span>· {t.source_app}</span>}
        <span>· {ago(t.created_at)}</span>
      </div>
      {t.context && t.context !== t.title && <p className="text-xs text-[#b8b8bc] mt-2 whitespace-pre-wrap break-words line-clamp-3">{t.context}</p>}
      {t.crop_url && <a href={t.crop_url} target="_blank" rel="noreferrer"><img src={t.crop_url} alt="" className="mt-2 rounded-md border border-line max-h-32 w-full object-cover" /></a>}
      {(t.attachments || []).length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {t.attachments.map((a, i) => (
            <a key={i} className="chip" href={a.url} target="_blank" rel="noreferrer" title={a.url}>{a.kind === "link" ? "🔗" : a.kind === "folder" ? "🗂" : a.mime?.startsWith("image/") ? "🖼" : "📎"} <span className="truncate">{a.name}</span></a>
          ))}
        </div>
      )}
      {summary && <p className="mt-2 p-2.5 rounded-lg bg-[#101012] border border-line text-xs leading-relaxed whitespace-pre-wrap break-words">{summary.body}</p>}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {files.map((d) => (
            <a key={d.id} className="chip" href={d.url || "#"} target="_blank" rel="noreferrer">{d.kind === "pr" ? "🔀" : "📄"} <span className="truncate">{d.name}</span></a>
          ))}
        </div>
      )}
      {question && (
        <div className="mt-2 p-2.5 rounded-lg border border-ask/40 bg-ask/10">
          <p className="text-xs text-[#cfe0ff] mb-2 leading-relaxed">{String((question.payload as { question?: string })?.question || "The worker needs your input.")}</p>
          <div className="flex gap-1.5">
            <input className="input text-xs" placeholder="Answer…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onAnswer(t.id, text); setText(""); } }} />
            <button className="btn text-xs" onClick={() => { onAnswer(t.id, text); setText(""); }}>Send</button>
          </div>
        </div>
      )}
    </article>
  );
}
