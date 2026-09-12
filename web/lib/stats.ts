// Pure computations for /dashboard — no I/O, easy to reason about.
import type { Task, Worker } from "@/lib/types";

export type EventRow = { id: number; task_id: string; worker_id: string | null; kind: string; payload: Record<string, unknown> | null; cost_usd: number; at: string; task?: { title: string } | null };

export const HOURS = 12;

// tasks created vs done per hour, oldest → newest, last HOURS hours
export function throughput(tasks: Task[], now = Date.now()) {
  const buckets = Array.from({ length: HOURS }, (_, i) => {
    const start = now - (HOURS - 1 - i) * 3600e3;
    const d = new Date(start);
    return { label: `${String(d.getHours()).padStart(2, "0")}:00`, start: Math.floor(start / 3600e3) * 3600e3, created: 0, done: 0 };
  });
  const idx = (iso: string) => {
    const h = Math.floor(new Date(iso).getTime() / 3600e3) * 3600e3;
    return buckets.findIndex((b) => b.start === h);
  };
  for (const t of tasks) {
    const c = idx(t.created_at); if (c >= 0) buckets[c].created++;
    if (t.status === "done") { const d = idx(t.updated_at); if (d >= 0) buckets[d].done++; }
  }
  return buckets;
}

export function costByTask(tasks: Task[], limit = 8) {
  return tasks
    .map((t) => ({ id: t.id, title: t.title, cost: (t.events || []).reduce((s, e) => s + Number(e.cost_usd || 0), 0) }))
    .filter((r) => r.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, limit);
}

export function workerLoad(tasks: Task[], workers: Worker[]) {
  return workers
    .map((w) => ({
      id: w.id, name: w.name, kind: w.kind,
      done: tasks.filter((t) => t.worker_id === w.id && t.status === "done").length,
      active: tasks.filter((t) => t.worker_id === w.id && (t.status === "claimed" || t.status === "running")).length,
      alive: w.status !== "dead" && Date.now() - new Date(w.last_seen).getTime() < 60000,
    }))
    .sort((a, b) => b.done - a.done);
}

// median seconds from created to done, over done tasks
export function medianTimeToDone(tasks: Task[]) {
  const secs = tasks.filter((t) => t.status === "done").map((t) => (new Date(t.updated_at).getTime() - new Date(t.created_at).getTime()) / 1000).filter((s) => s >= 0).sort((a, b) => a - b);
  if (!secs.length) return null;
  return secs[Math.floor(secs.length / 2)];
}

export function fmtDuration(s: number | null) {
  if (s == null) return "—";
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

export function eventLine(e: EventRow): { icon: string; text: string } {
  const p = (e.payload || {}) as Record<string, unknown>;
  switch (e.kind) {
    case "claimed": return { icon: "▶", text: "claimed" };
    case "progress": return { icon: "…", text: String(p.text || p.message || "progress") };
    case "split": return { icon: "⑂", text: `split into ${Array.isArray(p.children) ? p.children.length : "sub"}tasks` };
    case "needs-human": return { icon: "?", text: String(p.question || "needs your answer") };
    case "human-answer": return { icon: "↩", text: `${p.by ? String(p.by).split("@")[0] + ": " : ""}${String(p.text || "")}` };
    case "done": return { icon: "✓", text: String(p.summary || "done") };
    case "failed": return { icon: "✗", text: String(p.error || "failed") };
    default: return { icon: "•", text: e.kind };
  }
}
