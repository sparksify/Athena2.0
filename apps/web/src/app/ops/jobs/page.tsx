import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { PingButton } from "./ping-button";
import { SignOutButton } from "./sign-out-button";

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
          <p className="text-sm text-zinc-500">{user.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <a className="px-2 text-sm text-zinc-600 underline-offset-4 hover:underline" href="/candidates/review">
            Identity review
          </a>
          <PingButton />
          <SignOutButton />
        </div>
      </div>

      <section className="mt-8">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-zinc-500">
              <th className="py-2 pr-4 font-medium">Type</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Created</th>
              <th className="py-2 pr-4 font-medium">Finished</th>
              <th className="py-2 font-medium">Error</th>
            </tr>
          </thead>
          <tbody>
            {(jobs ?? []).map((j) => (
              <tr key={j.id} className="border-b border-zinc-100">
                <td className="py-2 pr-4 font-mono">{j.type}</td>
                <td className="py-2 pr-4">
                  <span
                    className={
                      j.status === "succeeded"
                        ? "text-green-700"
                        : j.status === "failed"
                          ? "text-red-700"
                          : "text-zinc-600"
                    }
                  >
                    {j.status}
                  </span>
                </td>
                <td className="py-2 pr-4">{new Date(j.created_at).toLocaleString()}</td>
                <td className="py-2 pr-4">
                  {j.finished_at ? new Date(j.finished_at).toLocaleString() : "—"}
                </td>
                <td className="py-2 text-red-700">{j.error ?? ""}</td>
              </tr>
            ))}
            {(jobs ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-zinc-400">
                  No jobs yet. Trigger a ping.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="mt-10 grid grid-cols-1 gap-8 md:grid-cols-2">
        <section>
          <h2 className="text-sm font-semibold text-zinc-700">Recent events</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {(events ?? []).map((e) => (
              <li key={e.id} className="flex justify-between border-b border-zinc-100 py-1">
                <span className="font-mono">{e.type}</span>
                <span className="text-zinc-400">{new Date(e.created_at).toLocaleTimeString()}</span>
              </li>
            ))}
            {(events ?? []).length === 0 && <li className="text-zinc-400">None</li>}
          </ul>
        </section>
        <section>
          <h2 className="text-sm font-semibold text-zinc-700">Recent cost records</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {(costs ?? []).map((c) => (
              <li key={c.id} className="flex justify-between border-b border-zinc-100 py-1">
                <span className="font-mono">
                  {c.category}/{c.provider}
                </span>
                <span>${Number(c.amount_usd).toFixed(6)}</span>
              </li>
            ))}
            {(costs ?? []).length === 0 && <li className="text-zinc-400">None</li>}
          </ul>
        </section>
      </div>
    </main>
  );
}
