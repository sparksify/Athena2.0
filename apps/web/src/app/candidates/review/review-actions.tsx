"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export function ReviewActions({ reviewId, status }: { reviewId: string; status: "pending" | "merged" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(fn: "merge_candidates" | "reject_review" | "split_merge") {
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().rpc(fn, { p_review_id: reviewId });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {status === "pending" ? (
          <>
            <button
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
              onClick={() => call("merge_candidates")}
              disabled={busy}
            >
              Merge
            </button>
            <button
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50"
              onClick={() => call("reject_review")}
              disabled={busy}
            >
              Not the same person
            </button>
          </>
        ) : (
          <button
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50"
            onClick={() => call("split_merge")}
            disabled={busy}
          >
            Split
          </button>
        )}
      </div>
      {error && <span className="max-w-56 text-right text-xs text-red-600">{error}</span>}
    </div>
  );
}
