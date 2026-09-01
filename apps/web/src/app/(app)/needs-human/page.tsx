import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NeedsHumanPage() {
  const supabase = await supabaseServer();

  const [{ data: reviews }, { data: failedJobs }] = await Promise.all([
    supabase
      .from("identity_review")
      .select("id, score, method, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(50),
    supabase
      .from("agent_job")
      .select("id, type, error, created_at")
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const total = (reviews?.length ?? 0) + (failedJobs?.length ?? 0);

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">Needs a human</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {total === 0 ? "Queue is clear." : `${total} item(s) waiting`} — conversation
        escalations join this queue with Phase 6.
      </p>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-700">
          Identity reviews ({reviews?.length ?? 0})
        </h2>
        <ul className="mt-2 space-y-1 text-sm">
          {(reviews ?? []).map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded-md border border-zinc-200 bg-white px-4 py-2">
              <span>
                Possible duplicate · confidence{" "}
                <span className="font-mono">{Number(r.score).toFixed(2)}</span> · {r.method}
              </span>
              <a className="text-sm underline-offset-4 hover:underline" href="/candidates/review">
                Review →
              </a>
            </li>
          ))}
          {(reviews ?? []).length === 0 && <li className="py-2 text-zinc-400">None pending.</li>}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-700">
          Failed agent jobs ({failedJobs?.length ?? 0})
        </h2>
        <ul className="mt-2 space-y-1 text-sm">
          {(failedJobs ?? []).map((j) => (
            <li key={j.id} className="rounded-md border border-zinc-200 bg-white px-4 py-2">
              <div className="flex justify-between">
                <span className="font-mono text-xs">{j.type}</span>
                <span className="text-xs text-zinc-400">{new Date(j.created_at).toLocaleString()}</span>
              </div>
              {j.error && <div className="mt-1 truncate text-xs text-red-700">{j.error}</div>}
            </li>
          ))}
          {(failedJobs ?? []).length === 0 && <li className="py-2 text-zinc-400">None.</li>}
        </ul>
      </section>
    </main>
  );
}
