import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import { getViewer } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ago, type Deliverable } from "@/lib/types";

export const dynamic = "force-dynamic";

type Row = Deliverable & { task: { id: string; title: string; source_app: string | null; status: string; worker: { name: string; kind: string } | null } | null };

// The library: everything the crew ever produced, newest first, grouped by day.
export default async function Results() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const supabase = await createClient();

  const { data } = await supabase
    .from("deliverables")
    .select("*,task:tasks(id,title,source_app,status,worker:workers(name,kind))")
    .order("created_at", { ascending: false })
    .limit(500);
  const rows = (data ?? []) as unknown as Row[];

  const groups: { day: string; rows: Row[] }[] = [];
  for (const r of rows) {
    const day = new Date(r.created_at).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.rows.push(r); else groups.push({ day, rows: [r] });
  }
  const files = rows.filter((r) => r.kind === "file").length;
  const prs = rows.filter((r) => r.kind === "pr").length;

  return (
    <Shell viewer={viewer} active="results">
      <div className="fade-in flex flex-col gap-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Results</h1>
            <p className="text-sm text-dim mt-0.5">Everything the crew delivered. Files also land in your results folder on the desktop.</p>
          </div>
          <div className="ml-auto flex gap-2">
            <div className="stat"><b>{rows.length}</b><span>results</span></div>
            <div className="stat"><b>{files}</b><span>files</span></div>
            <div className="stat"><b>{prs}</b><span>pull requests</span></div>
          </div>
        </div>

        {groups.length === 0 && (
          <div className="surface empty py-16"><span className="glyph" />Nothing delivered yet.<span className="text-[11px]">Finished tasks show up here the moment a worker marks them done.</span></div>
        )}

        {groups.map((g) => (
          <section key={g.day}>
            <h2 className="text-[11px] uppercase tracking-[.14em] text-dim mb-2 px-1">{g.day}</h2>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {g.rows.map((d) => {
                const kind = (d.task?.worker?.kind || "").toLowerCase();
                const icon = d.kind === "pr" ? "🔀" : d.kind === "text" ? "📝" : "📄";
                const inner = (
                  <>
                    <div className="flex items-start gap-3">
                      <span className="text-xl leading-none mt-0.5">{icon}</span>
                      <div className="min-w-0 flex-1">
                        {d.kind === "text"
                          ? <p className="text-sm text-[#dcdce0] leading-relaxed whitespace-pre-wrap break-words line-clamp-4">{d.body}</p>
                          : <div className="font-semibold text-sm truncate">{d.name}</div>}
                        <div className="text-[11px] text-dim mt-1.5 truncate">{d.task?.title}{d.task?.source_app ? ` · ${d.task.source_app}` : ""}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-3 text-[11px] text-dim">
                      {d.task?.worker
                        ? <span className="inline-flex items-center gap-1.5"><span className={`avatar ${kind} !w-4 !h-4 !text-[9px]`}>{d.task.worker.name.charAt(0).toUpperCase()}</span>{d.task.worker.name}</span>
                        : <span>—</span>}
                      <span className="ml-auto">{ago(d.created_at)}</span>
                      {d.url && <span className="text-amber-2">open ↗</span>}
                    </div>
                  </>
                );
                return d.url
                  ? <a key={d.id} href={d.url} target="_blank" rel="noreferrer" className="card p-3.5 block">{inner}</a>
                  : <div key={d.id} className="card p-3.5">{inner}</div>;
              })}
            </div>
          </section>
        ))}
      </div>
    </Shell>
  );
}
