"use client";

import { useRef, useState, useTransition } from "react";
import {
  addMailbox, createCampaign, draftBatch, setCampaignStatus, setMailboxStatus, suppressManually,
  type ManageResult,
} from "./actions";

const INPUT =
  "rounded-md border border-[#2A3447] bg-[#0F1522] px-3 py-1.5 text-sm text-[#E7ECF3] placeholder:text-[#3D4A5C] focus:border-indigo-500 focus:outline-none";
const BTN_PRIMARY =
  "rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50";
const BTN_GHOST =
  "rounded-md border border-[#2A3447] px-2.5 py-1 text-xs text-[#C3CCDB] hover:bg-[#161D2B] disabled:opacity-50";

function useAction() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const run = (fn: () => Promise<ManageResult>, after?: () => void) =>
    startTransition(async () => {
      setMsg(null);
      const res = await fn();
      setMsg(res.ok ? (res.detail ?? null) : (res.error ?? "failed"));
      if (res.ok) after?.();
    });
  return { pending, msg, run };
}

export function NewCampaignForm() {
  const { pending, msg, run } = useAction();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      action={(fd) => run(() => createCampaign(fd), () => ref.current?.reset())}
      className="flex flex-wrap items-center gap-2"
    >
      <input name="name" placeholder="Campaign name" className={INPUT} required />
      <label className="flex items-center gap-1.5 text-xs text-[#8B95A7]">
        min score
        <input name="minScore" type="number" defaultValue={50} min={0} max={100} className={`${INPUT} w-20`} />
      </label>
      <button className={BTN_PRIMARY} disabled={pending}>Create campaign</button>
      {msg && <span className="text-xs text-[#8B95A7]">{msg}</span>}
    </form>
  );
}

export function CampaignControls({ id, status }: { id: string; status: string }) {
  const { pending, msg, run } = useAction();
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {status !== "active" && status !== "done" && (
        <button className={BTN_GHOST} disabled={pending} onClick={() => run(() => setCampaignStatus(id, "active"))}>
          Activate
        </button>
      )}
      {status === "active" && (
        <button className={BTN_GHOST} disabled={pending} onClick={() => run(() => setCampaignStatus(id, "paused"))}>
          Pause
        </button>
      )}
      <button className={BTN_GHOST} disabled={pending} onClick={() => run(() => draftBatch(id, 10))}>
        Draft 10
      </button>
      {msg && <span className="text-xs text-amber-400">{msg}</span>}
    </span>
  );
}

export function NewMailboxForm() {
  const { pending, msg, run } = useAction();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      action={(fd) => run(() => addMailbox(fd), () => ref.current?.reset())}
      className="flex flex-wrap items-center gap-2"
    >
      <input name="address" placeholder="amy@fcpool.com" className={INPUT} required />
      <input name="externalRef" placeholder="Smartlead account id" className={`${INPUT} w-44`} />
      <label className="flex items-center gap-1.5 text-xs text-[#8B95A7]">
        cap/day
        <input name="dailyCap" type="number" defaultValue={30} min={1} className={`${INPUT} w-16`} />
      </label>
      <button className={BTN_PRIMARY} disabled={pending}>Add mailbox</button>
      {msg && <span className="text-xs text-[#8B95A7]">{msg}</span>}
    </form>
  );
}

export function MailboxControls({ id, status }: { id: string; status: string }) {
  const { pending, run } = useAction();
  const next = status === "active" ? "paused" : "active";
  return (
    <button className={BTN_GHOST} disabled={pending} onClick={() => run(() => setMailboxStatus(id, next))}>
      {status === "active" ? "Pause" : "Activate"}
    </button>
  );
}

export function SuppressForm() {
  const { pending, msg, run } = useAction();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      action={(fd) => run(() => suppressManually(fd), () => ref.current?.reset())}
      className="flex flex-wrap items-center gap-2"
    >
      <input name="email" type="email" placeholder="email to suppress" className={INPUT} required />
      <input name="reason" placeholder="reason" className={`${INPUT} w-36`} />
      <button className="rounded-md bg-red-600/80 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50" disabled={pending}>
        Suppress
      </button>
      {msg && <span className="text-xs text-[#8B95A7]">{msg}</span>}
    </form>
  );
}
