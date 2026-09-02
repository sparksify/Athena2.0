"use client";

import { useState, useTransition } from "react";
import { approve, reject } from "./actions";

export function ReviewButtons({ draftId }: { draftId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "failed");
    });

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => run(() => approve(draftId))}
        disabled={pending}
        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        Approve
      </button>
      <button
        onClick={() => run(() => reject(draftId, "rejected in review"))}
        disabled={pending}
        className="rounded-md border border-[#2A3447] px-3 py-1.5 text-xs text-[#C3CCDB] hover:bg-[#161D2B] disabled:opacity-50"
      >
        Reject
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
