import Link from "next/link";
import type { Viewer } from "@/lib/session";
import Copilot from "@/components/Copilot";

export default function Shell({ viewer, active, children }: { viewer: Viewer; active: "board" | "dashboard" | "results"; children: React.ReactNode }) {
  const tab = (href: string, key: string, label: string) => (
    <Link href={href} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${active === key ? "bg-card-2 text-white shadow-[inset_0_0_0_1px_var(--color-line-2)]" : "text-dim hover:text-white hover:bg-card"}`}>{label}</Link>
  );
  const initial = (viewer.name || viewer.email || "?").trim().charAt(0).toUpperCase();
  return (
    <div className="flex-1 flex flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-4 px-5 py-3 border-b border-line bg-[rgba(15,15,17,.8)] backdrop-blur">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="ring" />
          <span className="font-semibold tracking-tight">Crewboard</span>
        </Link>
        <nav className="flex gap-1 ml-3">
          {tab("/", "board", "Board")}
          {tab("/dashboard", "dashboard", "Dashboard")}
          {tab("/results", "results", "Results")}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden sm:block text-xs text-dim truncate max-w-[220px]" title={viewer.email}>{viewer.name}</span>
          <span className="avatar human" title={viewer.email}>{initial}</span>
          {viewer.provider === "auth0"
            ? <a href="/auth/logout" className="text-xs text-dim hover:text-amber">sign out</a>
            : <form action="/supabase/signout" method="post"><button className="text-xs text-dim hover:text-amber" type="submit">sign out</button></form>}
        </div>
      </header>
      <main className="flex-1 p-5">
        <Copilot>{children}</Copilot>
      </main>
    </div>
  );
}
