"use client";

import { useState, useTransition } from "react";
import { accept, decline, disposition, firstTouch, takeBack, type ActionResult } from "../actions";

const GHOST = "rounded-md border border-[#2A3447] px-2.5 py-1 text-xs text-[#C3CCDB] hover:bg-[#161D2B] disabled:opacity-50";
const PRIMARY = "rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50";
const INPUT = "rounded-md border border-[#2A3447] bg-[#0F1522] px-2 py-1 text-xs text-[#E7ECF3] placeholder:text-[#3D4A5C] focus:border-indigo-500 focus:outline-none";

function useAct() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => { setMsg(null); const r = await fn(); if (r.error) setMsg(r.error); });
  return { pending, msg, run };
}

export function OfferControls({ assignmentId }: { assignmentId: string }) {
  const { pending, msg, run } = useAct();
  const [reason, setReason] = useState("");
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <button className={PRIMARY} disabled={pending} onClick={() => run(() => accept(assignmentId))}>Accept</button>
      <input className={INPUT} placeholder="decline reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className={GHOST} disabled={pending} onClick={() => run(() => decline(assignmentId, reason))}>Decline</button>
      {msg && <span className="text-xs text-amber-300">{msg}</span>}
    </span>
  );
}

export function FirstTouchControls({ assignmentId }: { assignmentId: string }) {
  const { pending, msg, run } = useAct();
  const [channel, setChannel] = useState("call");
  const [note, setNote] = useState("");
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <select className={INPUT} value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel">
        <option value="call">Called</option><option value="email_sent">Emailed</option><option value="sms">Texted</option><option value="meeting">Met</option>
      </select>
      <input className={INPUT} placeholder="note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className={PRIMARY} disabled={pending} onClick={() => run(() => firstTouch(assignmentId, channel, note))}>Log first contact</button>
      {msg && <span className="text-xs text-amber-300">{msg}</span>}
    </span>
  );
}

export function DispositionControls({ appointmentId }: { appointmentId: string }) {
  const { pending, msg, run } = useAct();
  const [notes, setNotes] = useState("");
  const codes: [string, string][] = [["1", "Showed · advancing"], ["2", "Showed · not a fit"], ["3", "No-show"], ["4", "Rescheduled"]];
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {codes.map(([c, label]) => (
        <button key={c} className={c === "1" ? PRIMARY : GHOST} disabled={pending} onClick={() => run(() => disposition(appointmentId, c, notes))}>{c} · {label}</button>
      ))}
      <input className={INPUT} placeholder="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      {msg && <span className="text-xs text-amber-300">{msg}</span>}
    </span>
  );
}

export function TakeBackButton({ assignmentId }: { assignmentId: string }) {
  const { pending, msg, run } = useAct();
  return (
    <span className="flex items-center gap-1.5">
      <button className="rounded-md border border-red-500/40 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50" disabled={pending} onClick={() => run(() => takeBack(assignmentId))}>Take back & re-route</button>
      {msg && <span className="text-xs text-amber-300">{msg}</span>}
    </span>
  );
}
