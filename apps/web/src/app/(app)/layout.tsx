import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";

const NAV = [
  { href: "/", label: "Today" },
  { href: "/candidates", label: "Candidates" },
  { href: "/candidates/scores", label: "Scores" },
  { href: "/candidates/review", label: "Identity review" },
  { href: "/needs-human", label: "Needs a human" },
  { href: "/ops/jobs", label: "Agent jobs" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: appUser } = await supabase
    .from("user")
    .select("role")
    .eq("id", user.id)
    .single();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-52 shrink-0 flex-col border-r border-zinc-200 bg-white">
        <div className="px-5 py-5">
          <div className="text-lg font-semibold tracking-tight">ATHENA</div>
          <div className="mt-0.5 truncate text-xs text-zinc-500">{user.email}</div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-400">
            {appUser?.role ?? "no role"}
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-md px-2.5 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="p-4">
          <SignOutButton />
        </div>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
