import Link from "next/link";

export default function Shell({ email, active, children }: { email: string; active: "board" | "results"; children: React.ReactNode }) {
  const tab = (href: string, key: string, label: string) => (
    <Link href={href} className={`px-3 py-1.5 rounded-lg text-sm ${active === key ? "bg-card text-white" : "text-dim hover:text-white"}`}>{label}</Link>
  );
  return (
    <div className="flex-1 flex flex-col">
      <header className="flex items-center gap-4 px-5 py-3 border-b border-line">
        <span className="ring" />
        <span className="font-semibold">Crewboard</span>
        <nav className="flex gap-1 ml-4">
          {tab("/", "board", "Board")}
          {tab("/results", "results", "Results")}
        </nav>
        <span className="ml-auto text-xs text-dim">{email}</span>
        <form action="/auth/signout" method="post">
          <button className="text-xs text-dim hover:text-amber" type="submit">sign out</button>
        </form>
      </header>
      <main className="flex-1 p-5">{children}</main>
    </div>
  );
}
