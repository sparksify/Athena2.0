"use client";

import { useRef, useState, useTransition } from "react";
import { inviteUser, removeUser, resendInvite, setUserRole, type SettingsResult } from "./actions";
import { ROLES, type Role } from "./roles";

const INPUT = "rounded-md border border-[#2A3447] bg-[#0F1522] px-2 py-1.5 text-xs text-[#E7ECF3] placeholder:text-[#3D4A5C] focus:border-indigo-500 focus:outline-none";
const PRIMARY = "rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50";
const GHOST = "rounded-md border border-[#2A3447] px-2.5 py-1 text-xs text-[#C3CCDB] hover:bg-[#161D2B] disabled:opacity-50";
const label = (r: string) => r.replace("_", " ");

function useAct() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<SettingsResult>, after?: () => void) =>
    start(async () => { setMsg(null); const r = await fn(); setMsg({ ok: r.ok, text: r.ok ? (r.detail ?? "Done.") : (r.error ?? "failed") }); if (r.ok) after?.(); });
  return { pending, msg, run };
}

export function InviteForm({ canSuperAdmin, disabled }: { canSuperAdmin: boolean; disabled: boolean }) {
  const { pending, msg, run } = useAct();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} className="flex flex-wrap items-end gap-2" action={(fd) => run(() => inviteUser(fd), () => ref.current?.reset())}>
      <label className="block"><span className="block text-[11px] uppercase tracking-wide text-[#64748B]">Email</span><input name="email" type="email" required placeholder="pete@example.com" className={`${INPUT} w-56`} disabled={disabled} /></label>
      <label className="block"><span className="block text-[11px] uppercase tracking-wide text-[#64748B]">Name</span><input name="full_name" placeholder="Pete" className={`${INPUT} w-40`} disabled={disabled} /></label>
      <label className="block"><span className="block text-[11px] uppercase tracking-wide text-[#64748B]">Role</span>
        <select name="role" defaultValue="manager" className={INPUT} disabled={disabled}>
          {ROLES.filter((r) => canSuperAdmin || r !== "super_admin").map((r) => <option key={r} value={r}>{label(r)}</option>)}
        </select>
      </label>
      <button className={PRIMARY} disabled={disabled || pending}>{pending ? "Sending…" : "Send invitation"}</button>
      {msg && <span className={`text-xs ${msg.ok ? "text-[#C3CCDB]" : "text-red-400"}`}>{msg.text}</span>}
    </form>
  );
}

export function UserControls({ id, role, isSelf, canSuperAdmin, disabledAt }: { id: string; role: Role; isSelf: boolean; canSuperAdmin: boolean; disabledAt: string | null }) {
  const { pending, msg, run } = useAct();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={role} onChange={(e) => run(() => setUserRole(id, e.target.value as Role))} disabled={pending || isSelf || Boolean(disabledAt)} className={INPUT}>
        {ROLES.filter((r) => canSuperAdmin || r !== "super_admin" || r === role).map((r) => <option key={r} value={r}>{label(r)}</option>)}
      </select>
      {!disabledAt && !isSelf && <button className={GHOST} disabled={pending} onClick={() => run(() => resendInvite(id))}>Resend login email</button>}
      {!disabledAt && !isSelf && role !== "super_admin" && (
        <button className="rounded-md border border-red-900/60 px-2.5 py-1 text-xs text-red-300 hover:bg-red-950/40 disabled:opacity-50" disabled={pending}
          onClick={() => { if (window.confirm("Remove this user's login?")) run(() => removeUser(id)); }}>Remove</button>
      )}
      {msg && <span className={`text-xs ${msg.ok ? "text-[#C3CCDB]" : "text-red-400"}`}>{msg.text}</span>}
    </div>
  );
}
