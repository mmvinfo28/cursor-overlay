export type TaskStatus = "open" | "claimed" | "running" | "needs-human" | "done" | "failed";

export type Worker = { id: string; name: string; kind: string; capabilities: string[]; last_seen: string; status: string };

export type Deliverable = { id: string; task_id: string; kind: "file" | "pr" | "text"; name: string; url: string | null; body: string | null; created_at: string };

export type Event = { id: number; task_id: string; kind: string; payload: Record<string, unknown> | null; cost_usd: number; at: string };

export type Task = {
  id: string;
  parent_id: string | null;
  title: string;
  context: string | null;
  source_app: string | null;
  crop_url: string | null;
  capability: string;
  status: TaskStatus;
  worker_id: string | null;
  result: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  worker?: Pick<Worker, "name" | "kind"> | null;
  deliverables?: Deliverable[];
  events?: Event[];
};

export const TASK_SELECT = "*,worker:workers(name,kind),deliverables(*),events(id,kind,payload,cost_usd,at)";

export function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}
