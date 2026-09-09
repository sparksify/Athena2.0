"use client";

import { useState, useTransition } from "react";
import { routeNow } from "../../consultants/actions";

export function RouteButton({ candidateId }: { candidateId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <button
        disabled={pending}
        onClick={() => start(async () => { setMsg(null); const r = await routeNow(candidateId); setMsg(r.ok ? "Routed — intro queued." : (r.error ?? "failed")); })}
        className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        Route to a consultant
      </button>
      {msg && <span className="text-xs text-[#C3CCDB]">{msg}</span>}
    </span>
  );
}
