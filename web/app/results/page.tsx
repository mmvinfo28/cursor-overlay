import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import { getViewer } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ago, type Deliverable } from "@/lib/types";

export const dynamic = "force-dynamic";

type Row = Deliverable & { task: { id: string; title: string; source_app: string | null; status: string; worker: { name: string } | null } | null };

// The library: everything the crew ever produced, newest first.
export default async function Results() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const supabase = await createClient();

  const { data } = await supabase
    .from("deliverables")
    .select("*,task:tasks(id,title,source_app,status,worker:workers(name))")
    .order("created_at", { ascending: false })
    .limit(500);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <Shell viewer={viewer} active="results">
      <div className="rounded-xl border border-line overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#111113] text-dim text-xs uppercase tracking-wide">
            <tr><th className="text-left px-4 py-2">Result</th><th className="text-left px-4 py-2">Task</th><th className="text-left px-4 py-2">By</th><th className="text-left px-4 py-2">When</th></tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="border-t border-line hover:bg-card">
                <td className="px-4 py-2">
                  {d.kind === "text"
                    ? <span className="text-[#cfcfcf] whitespace-pre-wrap">{d.body}</span>
                    : <a className="chip" href={d.url || "#"} target="_blank" rel="noreferrer">{d.kind === "pr" ? "🔀" : "📄"} <span className="truncate">{d.name}</span></a>}
                </td>
                <td className="px-4 py-2 text-[#ddd]">{d.task?.title} <span className="text-dim text-xs">· {d.task?.source_app}</span></td>
                <td className="px-4 py-2 text-dim">{d.task?.worker?.name ?? "—"}</td>
                <td className="px-4 py-2 text-dim whitespace-nowrap">{ago(d.created_at)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-dim">Nothing delivered yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
