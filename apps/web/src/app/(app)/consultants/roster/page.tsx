import { sql } from "drizzle-orm";
import { getDb } from "@athena/db";
import { supabaseServer } from "@/lib/supabase/server";
import { PersonAvatar, resolveAvatar } from "@/components/agent-avatar";
import { GhlCrmAdapter } from "@athena/crm-ghl";
import { AddFromSubAccountForm, ConsultantForm, PersonaForm, StatusButton, SyncSubAccountsButton } from "./forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Consultant roster — Athena" };

const rows = <T,>(r: unknown): T[] => (Array.isArray(r) ? (r as T[]) : ((r as { rows?: T[] }).rows ?? []));

export interface RosterRow {
  id: string; name: string; email: string | null; phone: string | null; timezone: string; specialties: string[]; territories: string[];
  status: "active" | "paused"; max_load: number; user_id: string | null; ghl_ref: string | null; avatar_slug: string | null; active_load: number;
}
export interface PersonaRow { id: string; name: string; address: string | null; signature_html: string; active: boolean; avatar_slug: string | null; handoffs: number }
export interface UserOption { id: string; email: string; full_name: string | null }

export default async function RosterPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = user ? await supabase.from("user").select("role, org_id").eq("id", user.id).single() : { data: null };
  const manager = ["super_admin", "fcc_admin", "manager"].includes(me?.role ?? "");
  if (!manager) return <main className="p-6 text-sm text-[#8B95A7]">Managers and admins manage the roster.</main>;
  if (!process.env.DATABASE_URL || !me) return <main className="p-6 text-sm text-[#8B95A7]">The roster needs a database connection (DATABASE_URL).</main>;
  const db = getDb();
  const orgId = me.org_id as string;
  const [consultants, personas, users] = await Promise.all([
    rows<RosterRow>(await db.execute(sql`
      select c.*, (select count(*)::int from assignment a where a.consultant_id = c.id and a.status in ('offered','accepted')) as active_load
      from consultant c where c.org_id = ${orgId} order by c.status, c.name`)),
    rows<PersonaRow>(await db.execute(sql`
      select p.id, p.name, p.address, p.signature_html, p.active, p.avatar_slug,
        (select count(*)::int from assignment a where a.persona_mailbox_id = p.id) as handoffs
      from persona_mailbox p where p.org_id = ${orgId} order by p.name`)),
    rows<UserOption>(await db.execute(sql`select id, email, full_name from "user" where org_id = ${orgId} and role = 'consultant' order by email`)),
  ]);

  const onRoster = new Set(consultants.map((c) => c.ghl_ref).filter(Boolean));
  const subAccounts = GhlCrmAdapter.readConfigured()
    ? (await GhlCrmAdapter.listLocations({ scope: [] }).catch(() => [] as { id: string; name: string | null }[]))
        .filter((l) => !onRoster.has(l.id))
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
    : [];

  return (
    <main className="p-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#E7ECF3]">Consultant roster</h1>
          <p className="mt-1 text-[12px] text-[#8B95A7]">Routing reads this table: status, capacity, specialties and territories. Link a login so the consultant sees only their own leads.</p>
        </div>
        <nav className="flex gap-3 text-[12px] text-[#8B95A7]"><a className="hover:text-[#E7ECF3]" href="/consultants">Command board</a><a className="hover:text-[#E7ECF3]" href="/consultants/queue">Work queue</a></nav>
      </div>

      <section className="mt-6 overflow-x-auto rounded-lg border border-[#1E2635]">
        <table className="w-full text-[12px]">
          <thead className="bg-[#0F1522] text-left text-[11px] uppercase tracking-wide text-[#64748B]">
            <tr><th className="px-3 py-2">Consultant</th><th className="px-3 py-2">Contact</th><th className="px-3 py-2">Specialties</th><th className="px-3 py-2">Territories</th><th className="px-3 py-2">Load</th><th className="px-3 py-2">Login</th><th className="px-3 py-2">Status</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody>
            {consultants.map((c) => (
              <tr key={c.id} className="border-t border-[#1E2635] align-top">
                <td className="px-3 py-2"><span className="flex items-center gap-2"><PersonAvatar src={resolveAvatar(c.avatar_slug ?? c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"))} alt={c.name} size={26} /><span><span className="block font-medium text-[#E7ECF3]">{c.name}</span>{c.ghl_ref ? <span className="block text-[11px] text-emerald-300">GHL sub-account linked</span> : <span className="block text-[11px] text-red-300">no GHL sub-account</span>}</span></span></td>
                <td className="px-3 py-2 text-[#C3CCDB]">{c.email ?? <span className="text-red-300">no email</span>}<br />{c.phone ?? <span className="text-amber-300">no phone (no SMS nudges)</span>}</td>
                <td className="px-3 py-2 text-[#C3CCDB]">{c.specialties.join(", ") || "—"}</td>
                <td className="px-3 py-2 text-[#C3CCDB]">{c.territories.join(", ") || "national"}</td>
                <td className="px-3 py-2 text-[#C3CCDB]">{c.active_load} / {c.max_load}</td>
                <td className="px-3 py-2 text-[#C3CCDB]">{users.find((u) => u.id === c.user_id)?.email ?? <span className="text-[#64748B]">not linked</span>}</td>
                <td className="px-3 py-2"><StatusButton id={c.id} status={c.status} /></td>
                <td className="px-3 py-2"><details><summary className="cursor-pointer text-indigo-300">edit</summary><div className="mt-2"><ConsultantForm row={c} users={users} /></div></details></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="mt-4 rounded-lg border border-[#1E2635] bg-[#121826] p-4">
        <div className="text-[13px] font-medium text-[#E7ECF3]">Add a consultant</div>
        <p className="mb-3 mt-1 text-[12px] text-[#8B95A7]">Every consultant is a GoHighLevel sub-account. Pick theirs and Athena fills in the name, email, phone and timezone, and routes nudge texts, the pipeline mirror and lead lookups to that account.</p>
        {subAccounts.length ? <AddFromSubAccountForm options={subAccounts} /> : <p className="text-[12px] text-[#8B95A7]">{GhlCrmAdapter.readConfigured() ? "Every sub-account is already on the roster." : "Connect GoHighLevel (GHL_API_KEY + GHL_COMPANY_ID) to pick from sub-accounts."}</p>}
        <details className="mt-3">
          <summary className="cursor-pointer text-[12px] text-indigo-300">Add by hand instead</summary>
          <div className="mt-3"><ConsultantForm users={users} /></div>
        </details>
        <details className="mt-3">
          <summary className="cursor-pointer text-[12px] text-indigo-300">Re-match existing consultants to sub-accounts by name</summary>
          <div className="mt-3"><SyncSubAccountsButton /></div>
        </details>
      </div>

      <section className="mt-8">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#C3CCDB]">Named agents</h2>
        <p className="mt-1 text-[12px] text-[#8B95A7]">Tim, Sophie, Claire and Rina send warm intros from their own mailbox on the persona domain. An agent without an address can still be credited with handoffs, but intros stay queued until one is set.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {personas.map((p) => <PersonaForm key={p.id} row={p} avatar={resolveAvatar(p.avatar_slug ?? `agent-${p.name.toLowerCase()}`) ?? `/avatars/agent-${p.name.toLowerCase()}.svg`} />)}
        </div>
      </section>
    </main>
  );
}
