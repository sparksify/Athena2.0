import { supabaseServer } from "@/lib/supabase/server";
import { CandidatesTable, type CandidateRow } from "./candidates-table";

export const dynamic = "force-dynamic";

export default async function CandidatesPage() {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("candidate")
    .select("id, full_name, primary_email, primary_phone, city, state, status, current_score, created_at")
    .is("merged_into_id", null)
    .order("current_score", { ascending: false, nullsFirst: false })
    .limit(2000);

  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold">Candidates</h1>
      <p className="mt-1 text-sm text-[#8B95A7]">{data?.length ?? 0} candidates (top 2000 by score)</p>
      <CandidatesTable rows={(data ?? []) as CandidateRow[]} />
    </main>
  );
}
