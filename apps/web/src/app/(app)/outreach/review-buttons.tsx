"use client";

import { useState, useTransition } from "react";
import { approve, reject } from "./actions";

export function ReviewButtons({ draftId }: { draftId: string }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string; detail?: string }>) =>
    startTransition(async () => {
      setMsg(null);
      const res = await fn();
      setMsg(res.ok ? { ok: true, text: res.detail ?? "Done." } : { ok: false, text: res.error ?? "failed" });
      if (res.ok) setOpen(false);
    });

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <button onClick={() => run(() => approve(draftId))} disabled={pending}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
          Approve
        </button>
        <button onClick={() => setOpen((v) => !v)} disabled={pending}
          className="rounded-md border border-[#2A3447] px-3 py-1.5 text-xs text-[#C3CCDB] hover:bg-[#161D2B] disabled:opacity-50">
          {open ? "Cancel" : "Reject…"}
        </button>
      </div>
      {open && (
        <div className="w-80 rounded-md border border-[#1E2635] bg-[#121826] p-3">
          <label className="block text-[11px] uppercase tracking-wide text-[#64748B]">What should change?</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="too salesy; lead with their trade-show visit; shorter"
            className="mt-1 w-full rounded-md border border-[#2A3447] bg-[#0F1522] px-2 py-1.5 text-xs text-[#E7ECF3] placeholder:text-[#3D4A5C] focus:border-indigo-500 focus:outline-none" />
          <div className="mt-2 flex items-center gap-2">
            <button onClick={() => run(() => reject(draftId, note, true))} disabled={pending || !note.trim()}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
              {pending ? "Rewriting…" : "Reject & rewrite"}
            </button>
            <button onClick={() => run(() => reject(draftId, note, false))} disabled={pending}
              className="rounded-md border border-[#2A3447] px-3 py-1.5 text-xs text-[#C3CCDB] hover:bg-[#161D2B] disabled:opacity-50">
              Reject only
            </button>
          </div>
        </div>
      )}
      {msg && <span className={`text-xs ${msg.ok ? "text-[#C3CCDB]" : "text-red-400"}`}>{msg.text}</span>}
    </div>
  );
}
