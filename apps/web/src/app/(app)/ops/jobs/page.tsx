import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { PingButton } from "./ping-button";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: jobs }, { data: events }, { data: costs }] = await Promise.all([
    supabase
      .from("agent_job")
      .select("id, type, status, created_at, finished_at, error")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("event")
      .select("id, type, entity_type, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("cost_record")
      .select("id, category, provider, amount_usd, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  return (
    <main className="mx-auto max-w-5xl p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Agent jobs</h1>
          <p className="text-sm text-[#8B95A7]">{user.email}</p>
        </div>
        <PingButton />
      </div>

      <section className="mt-8">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[#1E2635] text-left text-[#8B95A7]">
              <th className="py-2 pr-4 font-medium">Type</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Created</th>
              <th className="py-2 pr-4 font-medium">Finished</th>
              <th className="py-2 font-medium">Error</th>
            </tr>
          </thead>
          <tbody>
            {(jobs ?? []).map((j) => (
              <tr key={j.id} className="border-b border-[#1A2130]">
                <td className="py-2 pr-4 font-mono">{j.type}</td>
                <td className="py-2 pr-4">
                  <span
                    className={
                      j.status === "succeeded"
                        ? "text-green-400"
                        : j.status === "failed"
                          ? "text-red-400"
                          : "text-[#A9B4C6]"
                    }
                  >
                    {j.status}
                  </span>
                </td>
                <td className="py-2 pr-4">{new Date(j.created_at).toLocaleString()}</td>
                <td className="py-2 pr-4">
                  {j.finished_at ? new Date(j.finished_at).toLocaleString() : "—"}
                </td>
                <td className="py-2 text-red-400">{j.error ?? ""}</td>
              </tr>
            ))}
            {(jobs ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-[#64748B]">
                  No jobs yet. Trigger a ping.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="mt-10 grid grid-cols-1 gap-8 md:grid-cols-2">
        <section>
          <h2 className="text-sm font-semibold text-[#C3CCDB]">Recent events</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {(events ?? []).map((e) => (
              <li key={e.id} className="flex justify-between border-b border-[#1A2130] py-1">
                <span className="font-mono">{e.type}</span>
                <span className="text-[#64748B]">{new Date(e.created_at).toLocaleTimeString()}</span>
              </li>
            ))}
            {(events ?? []).length === 0 && <li className="text-[#64748B]">None</li>}
          </ul>
        </section>
        <section>
          <h2 className="text-sm font-semibold text-[#C3CCDB]">Recent cost records</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {(costs ?? []).map((c) => (
              <li key={c.id} className="flex justify-between border-b border-[#1A2130] py-1">
                <span className="font-mono">
                  {c.category}/{c.provider}
                </span>
                <span>${Number(c.amount_usd).toFixed(6)}</span>
              </li>
            ))}
            {(costs ?? []).length === 0 && <li className="text-[#64748B]">None</li>}
          </ul>
        </section>
      </div>
    </main>
  );
}
