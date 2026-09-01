"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export function ManualPairForm() {
  const router = useRouter();
  const [emailA, setEmailA] = useState("");
  const [emailB, setEmailB] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function flag() {
    setBusy(true);
    setMessage(null);
    const supabase = supabaseBrowser();

    const { data: cands, error } = await supabase
      .from("candidate")
      .select("id, org_id, primary_email")
      .in("primary_email", [emailA.trim().toLowerCase(), emailB.trim().toLowerCase()])
      .is("merged_into_id", null);
    if (error || !cands || cands.length !== 2) {
      setBusy(false);
      setMessage(error?.message ?? "Need exactly two unmerged candidates with those primary emails.");
      return;
    }

    const { error: insertError } = await supabase.from("identity_review").insert({
      org_id: cands[0]!.org_id,
      candidate_a_id: cands[0]!.id,
      candidate_b_id: cands[1]!.id,
      score: 1.0,
      method: "manual",
      evidence: { flagged_by: "operator" },
    });
    setBusy(false);
    if (insertError) {
      setMessage(insertError.message);
      return;
    }
    setEmailA("");
    setEmailB("");
    router.refresh();
  }

  return (
    <div className="mt-2 flex max-w-2xl flex-wrap items-center gap-2">
      <input
        className="min-w-56 flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
        placeholder="candidate email A"
        value={emailA}
        onChange={(e) => setEmailA(e.target.value)}
      />
      <input
        className="min-w-56 flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
        placeholder="candidate email B"
        value={emailB}
        onChange={(e) => setEmailB(e.target.value)}
      />
      <button
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50"
        onClick={flag}
        disabled={busy || !emailA || !emailB}
      >
        Flag as possible duplicate
      </button>
      {message && <p className="w-full text-sm text-red-600">{message}</p>}
    </div>
  );
}
