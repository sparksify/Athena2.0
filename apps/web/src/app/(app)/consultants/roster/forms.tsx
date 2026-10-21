"use client";

import { useState, useTransition } from "react";
import { addConsultantFromSubAccount, deleteConsultant, setConsultantStatus, setConsultantToken, syncGhlSubAccounts, updatePersona, upsertConsultant, type ActionResult } from "../actions";
import type { PersonaRow, RosterRow, UserOption } from "./page";

const INPUT = "w-full rounded-md border border-[#2A3447] bg-[#0F1522] px-2 py-1.5 text-xs text-[#E7ECF3] placeholder:text-[#3D4A5C] focus:border-indigo-500 focus:outline-none";
const LABEL = "block text-[11px] uppercase tracking-wide text-[#64748B]";
const PRIMARY = "rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50";

function useAct() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult>) => start(async () => { setMsg(null); const r = await fn(); setMsg(r.ok ? (r.detail ?? "Saved.") : (r.error ?? "failed")); });
  return { pending, msg, run };
}

export function ConsultantForm({ row, users }: { row?: RosterRow; users: UserOption[] }) {
  const { pending, msg, run } = useAct();
  return (
    <form className="grid gap-2 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); run(() => upsertConsultant(new FormData(e.currentTarget))); }}>
      {row && <input type="hidden" name="id" value={row.id} />}
      <label><span className={LABEL}>Name</span><input name="name" defaultValue={row?.name} required className={INPUT} /></label>
      <label><span className={LABEL}>Email</span><input name="email" type="email" defaultValue={row?.email ?? ""} className={INPUT} /></label>
      <label><span className={LABEL}>Mobile (SMS nudges)</span><input name="phone" defaultValue={row?.phone ?? ""} placeholder="+1 555 555 0100" className={INPUT} /></label>
      <label><span className={LABEL}>Timezone</span><input name="timezone" defaultValue={row?.timezone ?? "America/New_York"} className={INPUT} /></label>
      <label><span className={LABEL}>Specialties (comma-separated)</span><input name="specialties" defaultValue={row?.specialties.join(", ") ?? ""} placeholder="home services, food, fitness" className={INPUT} /></label>
      <label><span className={LABEL}>Territories (state codes)</span><input name="territories" defaultValue={row?.territories.join(", ") ?? ""} placeholder="TX, OK — blank = national" className={INPUT} /></label>
      <label><span className={LABEL}>Max active leads</span><input name="max_load" type="number" min={1} defaultValue={row?.max_load ?? 20} className={INPUT} /></label>
      <label><span className={LABEL}>Athena login</span>
        <select name="user_id" defaultValue={row?.user_id ?? ""} className={INPUT}>
          <option value="">not linked</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.full_name ? `${u.full_name} · ` : ""}{u.email}</option>)}
        </select>
      </label>
      <label className="md:col-span-2"><span className={LABEL}>GHL sub-account (location) ID</span><input name="ghl_ref" defaultValue={row?.ghl_ref ?? ""} placeholder="their sub-account id; texts and the pipeline mirror go here" className={INPUT} /></label>
      <div className="flex items-end gap-2 md:col-span-2"><button className={PRIMARY} disabled={pending}>{row ? "Save" : "Add consultant"}</button>{msg && <span className="text-xs text-[#C3CCDB]">{msg}</span>}</div>
    </form>
  );
}

export function AddFromSubAccountForm({ options }: { options: { id: string; name: string | null }[] }) {
  const { pending, msg, run } = useAct();
  const [picked, setPicked] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-72 flex-1"><span className={LABEL}>GHL sub-account</span>
        <select value={picked} onChange={(e) => setPicked(e.target.value)} className={INPUT}>
          <option value="">pick a consultant…</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name ?? o.id}</option>)}
        </select>
      </label>
      <button className={PRIMARY} disabled={pending || !picked} onClick={() => run(() => addConsultantFromSubAccount(picked))}>{pending ? "Adding…" : "Add to roster"}</button>
      {msg && <span className="text-xs text-[#C3CCDB]">{msg}</span>}
    </div>
  );
}

export function TokenForm({ id, hasToken, linked }: { id: string; hasToken: boolean; linked: boolean }) {
  const { pending, msg, run } = useAct();
  const [token, setToken] = useState("");
  return (
    <div className="mt-3 rounded-md border border-[#1E2635] bg-[#0F1522] p-3">
      <div className="text-[11px] uppercase tracking-wide text-[#64748B]">GHL sub-account token</div>
      <p className="mt-1 text-[11px] text-[#8B95A7]">
        {hasToken ? "A token is on file. Paste a new one to replace it." : "Optional. With the Athena app connected to the agency, nothing is needed here. Paste a token only to override it for this consultant: in their sub-account, Settings → Private Integrations → create one with Contacts, Conversations, Conversation Messages, Opportunities and Calendar Events."}
        {!linked && " Link the sub-account first."}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="pit-…" className={`${INPUT} max-w-md`} disabled={!linked} />
        <button className={PRIMARY} disabled={pending || !token.trim() || !linked} onClick={() => run(async () => { const r = await setConsultantToken(id, token); if (r.ok) setToken(""); return r; })}>{hasToken ? "Replace token" : "Save token"}</button>
        {hasToken && <button className="rounded-md border border-[#2A3447] px-2.5 py-1.5 text-xs text-[#C3CCDB] hover:bg-[#161D2B] disabled:opacity-50" disabled={pending} onClick={() => run(() => setConsultantToken(id, ""))}>Remove</button>}
        {msg && <span className="text-xs text-[#C3CCDB]">{msg}</span>}
      </div>
    </div>
  );
}

export function DeleteButton({ id, name }: { id: string; name: string }) {
  const { pending, msg, run } = useAct();
  return (
    <span className="inline-flex items-center gap-2">
      <button className="rounded-md border border-red-900/60 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-950/40 disabled:opacity-50" disabled={pending}
        onClick={() => { if (window.confirm(`Remove ${name} from the roster?`)) run(() => deleteConsultant(id)); }}>
        {pending ? "Removing…" : "Remove from roster"}
      </button>
      {msg && <span className="text-xs text-[#C3CCDB]">{msg}</span>}
    </span>
  );
}

export function StatusButton({ id, status }: { id: string; status: "active" | "paused" }) {
  const { pending, run } = useAct();
  const next = status === "active" ? "paused" : "active";
  return (
    <button disabled={pending} onClick={() => run(() => setConsultantStatus(id, next))}
      className={`rounded-full px-2 py-0.5 text-[11px] ${status === "active" ? "bg-emerald-500/15 text-emerald-300" : "bg-[#1B2333] text-[#8B95A7]"}`} title={`Click to ${next === "paused" ? "pause" : "activate"}`}>
      {status}
    </button>
  );
}

export function PersonaForm({ row, avatar }: { row: PersonaRow; avatar: string }) {
  const { pending, msg, run } = useAct();
  return (
    <form className="rounded-lg border border-[#1E2635] bg-[#121826] p-4" onSubmit={(e) => { e.preventDefault(); run(() => updatePersona(new FormData(e.currentTarget))); }}>
      <input type="hidden" name="id" value={row.id} />
      <div className="flex items-center gap-2"><img src={avatar} alt={`${row.name} (AI agent)`} width={30} height={30} className="shrink-0 rounded-full border border-[#2A3447]" /><span className="font-medium text-[#E7ECF3]">{row.name}</span><span className="text-[11px] text-[#64748B]">{row.handoffs} handoffs</span></div>
      <label className="mt-3 block"><span className={LABEL}>Mailbox address</span><input name="address" type="email" defaultValue={row.address ?? ""} placeholder={`${row.name.toLowerCase()}@your-persona-domain.com`} className={INPUT} /></label>
      <label className="mt-2 block"><span className={LABEL}>Signature (plain text)</span><textarea name="signature" defaultValue={row.signature_html} rows={3} className={INPUT} /></label>
      <label className="mt-2 flex items-center gap-2 text-xs text-[#C3CCDB]"><input type="checkbox" name="active" defaultChecked={row.active} /> Active (can be assigned handoffs)</label>
      <div className="mt-3 flex items-center gap-2"><button className={PRIMARY} disabled={pending}>Save</button>{msg && <span className="text-xs text-[#C3CCDB]">{msg}</span>}</div>
    </form>
  );
}

export function SyncSubAccountsButton() {
  const [pending, start] = useTransition();
  const [out, setOut] = useState<Awaited<ReturnType<typeof syncGhlSubAccounts>> | null>(null);
  return (
    <div>
      <button className={PRIMARY} disabled={pending} onClick={() => start(async () => setOut(await syncGhlSubAccounts()))}>
        {pending ? "Syncing…" : "Sync from GHL: match sub-accounts and fill contact details"}
      </button>
      {out && !out.ok && <p className="mt-2 text-xs text-red-400">{out.error}</p>}
      {out?.ok && (
        <div className="mt-2 space-y-1 text-xs text-[#C3CCDB]">
          <div>Matched: {out.matched?.length ? out.matched.join(" · ") : "none new"}</div>
          <div>Contact details filled from GHL: {out.filled?.length ? out.filled.join(", ") : "none (already complete, or the sub-account has no email/phone on file)"}</div>
          {out.unmatchedConsultants?.length ? <div className="text-amber-300">Still need an ID: {out.unmatchedConsultants.join(", ")}</div> : null}
          {out.unmatchedLocations?.length ? <div className="text-[#8B95A7]">{out.unmatchedLocations.length} other sub-accounts in the agency are not consultants on this roster.</div> : null}
        </div>
      )}
    </div>
  );
}
