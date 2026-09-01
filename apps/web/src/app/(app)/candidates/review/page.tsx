import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { ManualPairForm } from "./manual-pair-form";
import { ReviewActions } from "./review-actions";

export const dynamic = "force-dynamic";

type CandidateCard = {
  id: string;
  full_name: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  city: string | null;
  state: string | null;
} | null;

type Review = {
  id: string;
  score: string;
  method: string;
  status: string;
  created_at: string;
  candidate_a: CandidateCard;
  candidate_b: CandidateCard;
};

const REVIEW_SELECT = `id, score, method, status, created_at,
  candidate_a:candidate!identity_review_candidate_a_id_fkey(id, full_name, primary_email, primary_phone, city, state),
  candidate_b:candidate!identity_review_candidate_b_id_fkey(id, full_name, primary_email, primary_phone, city, state)`;

function Card({ c }: { c: CandidateCard }) {
  if (!c) return <div className="text-[#64748B]">missing</div>;
  return (
    <div className="text-sm">
      <div className="font-medium">{c.full_name ?? "—"}</div>
      <div className="text-[#8B95A7]">{c.primary_email ?? "no email"}</div>
      <div className="text-[#8B95A7]">{c.primary_phone ?? "no phone"}</div>
      <div className="text-[#64748B]">
        {[c.city, c.state].filter(Boolean).join(", ") || "no location"}
      </div>
    </div>
  );
}

export default async function ReviewPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: pending }, { data: merged }] = await Promise.all([
    supabase
      .from("identity_review")
      .select(REVIEW_SELECT)
      .eq("status", "pending")
      .order("score", { ascending: false })
      .limit(100),
    supabase
      .from("identity_review")
      .select(REVIEW_SELECT)
      .eq("status", "merged")
      .order("reviewed_at", { ascending: false })
      .limit(20),
  ]);

  const pendingReviews = (pending ?? []) as unknown as Review[];
  const mergedReviews = (merged ?? []) as unknown as Review[];

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">Identity review</h1>
      <p className="mt-1 text-sm text-[#8B95A7]">
        Probable duplicates (0.60–0.85 confidence) wait here for a human. Merges are
        non-destructive and can be split.
      </p>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-[#C3CCDB]">
          Pending ({pendingReviews.length})
        </h2>
        <div className="mt-2 space-y-3">
          {pendingReviews.map((r) => (
            <div key={r.id} className="rounded-lg border border-[#1E2635] bg-[#121826] p-4">
              <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[1fr_1fr_auto]">
                <Card c={r.candidate_a} />
                <Card c={r.candidate_b} />
                <div className="flex flex-col items-end gap-2">
                  <span className="font-mono text-sm text-[#8B95A7]">
                    {Number(r.score).toFixed(2)} · {r.method}
                  </span>
                  <ReviewActions reviewId={r.id} status="pending" />
                </div>
              </div>
            </div>
          ))}
          {pendingReviews.length === 0 && (
            <p className="py-4 text-sm text-[#64748B]">Nothing waiting for review.</p>
          )}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold text-[#C3CCDB]">Recent merges (splittable)</h2>
        <div className="mt-2 space-y-3">
          {mergedReviews.map((r) => (
            <div key={r.id} className="rounded-lg border border-[#1E2635] bg-[#121826] p-4">
              <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[1fr_1fr_auto]">
                <Card c={r.candidate_a} />
                <Card c={r.candidate_b} />
                <div className="flex flex-col items-end gap-2">
                  <span className="font-mono text-sm text-[#8B95A7]">
                    {Number(r.score).toFixed(2)} · {r.method}
                  </span>
                  <ReviewActions reviewId={r.id} status="merged" />
                </div>
              </div>
            </div>
          ))}
          {mergedReviews.length === 0 && (
            <p className="py-4 text-sm text-[#64748B]">No merges yet.</p>
          )}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold text-[#C3CCDB]">Flag a pair manually</h2>
        <ManualPairForm />
      </section>
    </main>
  );
}
