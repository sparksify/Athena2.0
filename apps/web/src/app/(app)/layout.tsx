import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AthenaLogo } from "@/components/athena-logo";
import { AskAthena } from "@/components/ask-athena";
import { SignOutButton } from "./sign-out-button";

function NavIcon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

// Module map from docs/design/dashboard-mockup.md. Items without a phase yet
// render muted until their phase lands.
const NAV: {
  label: string;
  icon: string;
  href?: string;
  badge?: string;
  children?: { label: string; href: string }[];
}[] = [
  { label: "Overview", href: "/", icon: "M4 4h7v7H4zM13 4h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z" },
  { label: "Consultants", href: "/consultants", badge: "preview", icon: "M10 11a4 4 0 100-8 4 4 0 000 8zM3 21v-1a7 7 0 0114 0v1M16 11l2 2 4-4" }, // Phase 7 preview
  {
    label: "Candidates",
    href: "/candidates",
    icon: "M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a7 7 0 0114 0v1M17 8a3 3 0 100-6M22 21v-1a6 6 0 00-4-5.7",
  },
  { label: "Import", href: "/ops/import", icon: "M12 3v12m0-12L8 7m4-4l4 4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" },
  { label: "Conversations", icon: "M21 12a8 8 0 01-8 8H4l2-3a8 8 0 1115-5z" }, // Phase 6
  { label: "Opportunities", icon: "M12 21a9 9 0 110-18 9 9 0 010 18zm0-5a4 4 0 110-8" }, // Phase 7
  { label: "Appointments", icon: "M7 3v3m10-3v3M4 8h16M5 5h14a1 1 0 011 1v13a2 2 0 01-2 2H6a2 2 0 01-2-2V6a1 1 0 011-1z" }, // Phase 7
  { label: "Outreach", href: "/outreach", icon: "M3 11l16-6v14L3 13v-2zm4 3v4a2 2 0 004 0v-3" }, // Phase 5
  {
    label: "Intelligence",
    icon: "M9 3h6M12 3v3m-5 0h10a2 2 0 012 2v8a2 2 0 01-2 2H7a2 2 0 01-2-2V8a2 2 0 012-2zm2 4v4m6-4v4M12 18v3",
    children: [
      { label: "Scores", href: "/candidates/scores" },
      { label: "Identity review", href: "/candidates/review" },
    ],
  },
  { label: "Analytics", icon: "M4 20V10m6 10V4m6 16v-7m4 7H2" }, // Phase 9
  { label: "Agent Ops", href: "/ops/jobs", icon: "M4 5h16v11H4zM8 8l3 2.5L8 13m5 0h3M9 20h6m-3-4v4" },
  { label: "Settings", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zm8-3l1.5-1-1-2.6-1.8.3a7 7 0 00-1.7-1.7l.3-1.8L14.6 4 13.6 5.5a7 7 0 00-3.2 0L9.4 4 6.8 5.2l.3 1.8A7 7 0 005.4 8.7l-1.8-.3-1 2.6L4 12l-1.4 1 1 2.6 1.8-.3a7 7 0 001.7 1.7l-.3 1.8 2.6 1.2 1-1.5a7 7 0 003.2 0l1 1.5 2.6-1.2-.3-1.8a7 7 0 001.7-1.7l1.8.3 1-2.6z" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const [{ data: appUser }, { count: recentFailures }] = await Promise.all([
    supabase.from("user").select("role, full_name").eq("id", user.id).single(),
    supabase
      .from("agent_job")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString()),
  ]);
  const healthy = (recentFailures ?? 0) === 0;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-[#1E2635] bg-[#0D121C]">
        <div className="px-5 py-5">
          <AthenaLogo size={30} />
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {NAV.map((item) =>
            item.children ? (
              <div key={item.label}>
                <div className="flex items-center gap-2.5 px-2.5 py-1.5 text-sm text-[#C3CCDB]">
                  <NavIcon d={item.icon} />
                  {item.label}
                </div>
                {item.children.map((c) => (
                  <a
                    key={c.href}
                    href={c.href}
                    className="block rounded-md py-1.5 pl-9 pr-2.5 text-sm text-[#8B95A7] hover:bg-[#1B2333] hover:text-[#C3CCDB]"
                  >
                    {c.label}
                  </a>
                ))}
              </div>
            ) : item.href ? (
              <a
                key={item.label}
                href={item.href}
                className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-[#C3CCDB] hover:bg-[#1B2333]"
              >
                <NavIcon d={item.icon} />
                {item.label}
                {item.badge && (
                  <span className="ml-auto rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-400">
                    {item.badge}
                  </span>
                )}
              </a>
            ) : (
              <span
                key={item.label}
                className="flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-[#3D4A5C]"
                title="Arrives in a later phase"
              >
                <NavIcon d={item.icon} />
                {item.label}
              </span>
            ),
          )}
        </nav>
        <div className="mx-3 mb-3 rounded-lg border border-[#1E2635] bg-[#121826] px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wide text-[#64748B]">AI systems status</div>
          <div className={`mt-0.5 flex items-center gap-1.5 text-sm font-medium ${healthy ? "text-green-400" : "text-amber-400"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${healthy ? "bg-green-400" : "bg-amber-400"}`} />
            {healthy ? "Healthy" : "Needs attention"}
          </div>
          <div className="text-[11px] text-[#64748B]">
            {healthy ? "All systems operational" : `${recentFailures} failed job(s) in 24h`}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-[#1E2635] px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm">{appUser?.full_name ?? user.email}</div>
            <div className="text-[11px] capitalize text-[#64748B]">
              {(appUser?.role ?? "no role").replace("_", " ")}
            </div>
          </div>
          <SignOutButton />
        </div>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
      <AskAthena />
    </div>
  );
}
