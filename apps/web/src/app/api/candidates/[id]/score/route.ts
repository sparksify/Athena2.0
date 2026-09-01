import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/** "Why is Robert a 91" — the latest score snapshot's factor table. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [{ data: candidate }, { data: snapshots }] = await Promise.all([
    supabase.from("candidate").select("id, full_name, current_score, status").eq("id", id).single(),
    supabase
      .from("score_snapshot")
      .select("score, version, factors, created_at")
      .eq("candidate_id", id)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  if (!candidate) return NextResponse.json({ error: "not found" }, { status: 404 });
  const snapshot = snapshots?.[0] ?? null;
  if (!snapshot) return NextResponse.json({ candidate, score: null, factors: [] });

  return NextResponse.json({
    candidate: { id: candidate.id, fullName: candidate.full_name, status: candidate.status },
    score: snapshot.score,
    version: snapshot.version,
    scoredAt: snapshot.created_at,
    factors: snapshot.factors,
  });
}
