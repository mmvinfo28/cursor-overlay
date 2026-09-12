import { redirect } from "next/navigation";
import Board from "@/components/Board";
import Shell from "@/components/Shell";
import { getViewer } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { TASK_SELECT, type Task, type Worker } from "@/lib/types";

export const dynamic = "force-dynamic";

// The board: everything after sign-in lives under /dashboard.
export default async function DashboardBoard() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const supabase = await createClient();

  const [tasks, workers] = await Promise.all([
    supabase.from("tasks").select(TASK_SELECT).order("created_at", { ascending: false }).limit(200),
    supabase.from("workers").select("*").order("last_seen", { ascending: false }),
  ]);

  return (
    <Shell viewer={viewer} active="board">
      <Board initialTasks={(tasks.data ?? []) as unknown as Task[]} initialWorkers={(workers.data ?? []) as Worker[]} user={viewer.email || viewer.name} />
    </Shell>
  );
}
