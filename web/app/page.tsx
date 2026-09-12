import { redirect } from "next/navigation";
import Board from "@/components/Board";
import Shell from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";
import { TASK_SELECT, type Task, type Worker } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [tasks, workers] = await Promise.all([
    supabase.from("tasks").select(TASK_SELECT).order("created_at", { ascending: false }).limit(200),
    supabase.from("workers").select("*").order("last_seen", { ascending: false }),
  ]);

  return (
    <Shell email={user.email ?? ""} active="board">
      <Board initialTasks={(tasks.data ?? []) as unknown as Task[]} initialWorkers={(workers.data ?? []) as Worker[]} user={user.email ?? user.id} />
    </Shell>
  );
}
