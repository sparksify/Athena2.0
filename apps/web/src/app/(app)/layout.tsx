import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";

// Module map from docs/design/dashboard-mockup.md. Items without a phase yet
// render muted until their phase lands.
const NAV: { label: string; href?: string; children?: { label: string; href: string }[] }[] = [
  { label: "Overview", href: "/" },
  { label: "Candidates", href: "/candidates" },
  { label: "Conversations" }, // Phase 6
  { label: "Opportunities" }, // Phase 7
  { label: "Consultants" }, // Phase 7
  { label: "Appointments" }, // Phase 7
  { label: "Campaigns" }, // Phase 5
  {
    label: "Intelligence",
    children: [
      { label: "Scores", href: "/candidates/scores" },
      { label: "Identity review", href: "/candidates/review" },
    ],
  },
  { label: "Analytics" }, // Phase 9
  { label: "Agent Ops", href: "/ops/jobs" },
  { label: "Settings" },
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
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white">
            A
          </div>
          <span className="text-base font-semibold tracking-[0.18em]">ATHENA</span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {NAV.map((item) =>
            item.children ? (
              <div key={item.label}>
                <div className="px-2.5 py-1.5 text-sm text-[#C3CCDB]">{item.label}</div>
                {item.children.map((c) => (
                  <a
                    key={c.href}
                    href={c.href}
                    className="block rounded-md py-1.5 pl-7 pr-2.5 text-sm text-[#8B95A7] hover:bg-[#1B2333] hover:text-[#C3CCDB]"
                  >
                    {c.label}
                  </a>
                ))}
              </div>
            ) : item.href ? (
              <a
                key={item.label}
                href={item.href}
                className="rounded-md px-2.5 py-1.5 text-sm text-[#C3CCDB] hover:bg-[#1B2333]"
              >
                {item.label}
              </a>
            ) : (
              <span
                key={item.label}
                className="cursor-default rounded-md px-2.5 py-1.5 text-sm text-[#3D4A5C]"
                title="Arrives in a later phase"
              >
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
    </div>
  );
}
