"use client";

import { createContext, useContext, useMemo, useState, useTransition, type ReactNode } from "react";
import { approveMany, rejectMany } from "./actions";

const Ctx = createContext<{ selected: Set<string>; toggle: (id: string) => void; setAll: (ids: string[]) => void; clear: () => void } | null>(null);

/** Shared checkbox state for the approval queue; the list itself stays server-rendered. */
export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const value = useMemo(() => ({
    selected,
    toggle: (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    setAll: (ids: string[]) => setSelected(new Set(ids)),
    clear: () => setSelected(new Set()),
  }), [selected]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function DraftCheckbox({ id }: { id: string }) {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  return (
    <input type="checkbox" checked={ctx.selected.has(id)} onChange={() => ctx.toggle(id)} aria-label="Select draft"
      className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-[#2A3447] bg-[#0F1522] accent-indigo-500" />
  );
}

export function BulkBar({ allIds }: { allIds: string[] }) {
  const ctx = useContext(Ctx);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  if (!ctx || allIds.length === 0) return null;
  const n = ctx.selected.size;
  const all = n === allIds.length;
  const run = (fn: () => Promise<{ ok: boolean; error?: string; detail?: string }>) =>
    start(async () => { setMsg(null); const r = await fn(); setMsg(r.ok ? (r.detail ?? "Done.") : (r.error ?? "failed")); if (r.ok) ctx.clear(); });
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#1E2635] bg-[#0F1522] px-3 py-2 text-xs">
      <label className="flex cursor-pointer items-center gap-2 text-[#C3CCDB]">
        <input type="checkbox" checked={all} onChange={() => (all ? ctx.clear() : ctx.setAll(allIds))} className="h-4 w-4 accent-indigo-500" />
        {all ? "All selected" : `Select all ${allIds.length}`}
      </label>
      <span className="text-[#64748B]">{n} selected</span>
      <button disabled={pending || n === 0} onClick={() => run(() => approveMany([...ctx.selected]))}
        className="rounded-md bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
        {pending ? "Working…" : `Approve ${n || ""}`}
      </button>
      <button disabled={pending || n === 0} onClick={() => { if (window.confirm(`Reject ${n} drafts without rewriting?`)) run(() => rejectMany([...ctx.selected], "rejected in bulk review")); }}
        className="rounded-md border border-[#2A3447] px-3 py-1.5 text-[#C3CCDB] hover:bg-[#161D2B] disabled:opacity-50">
        Reject selected
      </button>
      {msg && <span className="text-[#C3CCDB]">{msg}</span>}
    </div>
  );
}
