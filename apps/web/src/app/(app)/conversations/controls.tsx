"use client";

import { useRef, useState, useTransition } from "react";
import { close, override, reply, takeIt, type ConvActionResult } from "./actions";

const INPUT = "rounded-md border border-[#2A3447] bg-[#0F1522] px-3 py-1.5 text-sm text-[#E7ECF3] placeholder:text-[#3D4A5C] focus:border-indigo-500 focus:outline-none";
const GHOST = "rounded-md border border-[#2A3447] px-2.5 py-1 text-xs text-[#C3CCDB] hover:bg-[#161D2B] disabled:opacity-50";

function useAct() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const run = (fn: () => Promise<ConvActionResult>) =>
    start(async () => { setMsg(null); const r = await fn(); if (!r.ok) setMsg(r.error ?? "failed"); });
  return { pending, msg, run };
}

export function OverrideSelect({ messageId, current, classes }: { messageId: string; current: string | null; classes: readonly string[] }) {
  const { pending, msg, run } = useAct();
  return (
    <span className="flex items-center gap-2">
      <select
        defaultValue={current ?? ""}
        disabled={pending}
        onChange={(e) => { if (e.target.value && e.target.value !== current) run(() => override(messageId, e.target.value)); }}
        className={`${INPUT} py-1 text-xs`}
        aria-label="Override classification"
      >
        {!current && <option value="">unclassified</option>}
        {classes.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
      </select>
      {msg && <span className="text-xs text-red-400">{msg}</span>}
    </span>
  );
}

export function ThreadControls({ conversationId, state }: { conversationId: string; state: string }) {
  const { pending, msg, run } = useAct();
  return (
    <span className="flex items-center gap-1.5">
      <button className={GHOST} disabled={pending} onClick={() => run(() => takeIt(conversationId))}>Take it</button>
      {state !== "closed" && <button className={GHOST} disabled={pending} onClick={() => run(() => close(conversationId))}>Close</button>}
      {msg && <span className="text-xs text-red-400">{msg}</span>}
    </span>
  );
}

export function ReplyForm({ conversationId, defaultSubject }: { conversationId: string; defaultSubject: string }) {
  const { pending, msg, run } = useAct();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={(fd) => run(async () => { const r = await reply(conversationId, fd); if (r.ok) ref.current?.reset(); return r; })} className="space-y-2">
      <input name="subject" defaultValue={defaultSubject} className={`${INPUT} w-full`} required />
      <textarea name="body" rows={5} placeholder="Write as yourself. Plain text, no templates." className={`${INPUT} w-full`} required />
      <div className="flex items-center gap-3">
        <button className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50" disabled={pending}>Send reply</button>
        {msg && <span className="text-xs text-amber-400">{msg}</span>}
      </div>
    </form>
  );
}
