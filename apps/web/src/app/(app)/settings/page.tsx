import { sql } from "drizzle-orm";
import { getDb } from "@athena/db";
import { supabaseServer } from "@/lib/supabase/server";
import { InviteForm, UserControls } from "./forms";
import { authAdminConfigured } from "./actions";
import type { Role } from "./roles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings — Athena" };

const rows = <T,>(r: unknown): T[] => (Array.isArray(r) ? (r as T[]) : ((r as { rows?: T[] }).rows ?? []));
interface UserRow { id: string; email: string; full_name: string | null; role: Role; created_at: string; disabled_at: string | null; consultant_name: string | null }

const ROLE_HELP: Record<Role, string> = {
  super_admin: "Everything, including other admins and this page.",
  fcc_admin: "Everything operational, plus user management.",
  manager: "Imports, campaigns, approvals, roster, consultant board; sees all consultants and financials.",
  consultant: "Only their own leads, assignments and appointments; no financials. Link them on the roster.",
  analyst: "Read access to candidates, scores and analytics.",
  read_only: "Can look, cannot change anything.",
};

export default async function SettingsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = user ? await supabase.from("user").select("role, org_id").eq("id", user.id).single() : { data: null };
  const isAdmin = ["super_admin", "fcc_admin"].includes(me?.role ?? "");
  if (!isAdmin || !me || !user) return <main className="p-6 text-sm text-[#8B95A7]">Admins manage settings.</main>;
  if (!process.env.DATABASE_URL) return <main className="p-6 text-sm text-[#8B95A7]">Settings need a database connection.</main>;
  const canSuperAdmin = me.role === "super_admin";
  const authReady = await authAdminConfigured();

  const users = rows<UserRow>(await getDb().execute(sql`
    select u.id, u.email, u.full_name, u.role, u.created_at, u.disabled_at,
      (select c.name from consultant c where c.user_id = u.id limit 1) as consultant_name
    from "user" u where u.org_id = ${me.org_id as string}
    order by u.disabled_at nulls first, case u.role when 'super_admin' then 0 when 'fcc_admin' then 1 when 'manager' then 2 else 3 end, u.email`));

  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold text-[#E7ECF3]">Settings</h1>
      <p className="mt-1 text-[12px] text-[#8B95A7]">Who can sign in to Athena and what they can do. Invitations go out by email from Supabase; the person sets a password on first visit.</p>

      {!authReady && (
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          <strong>One-time setup:</strong> inviting and removing users needs <code>SUPABASE_SERVICE_ROLE_KEY</code> on Vercel. Supabase → Project Settings → API keys → copy the <em>service_role</em> key → Vercel env var → redeploy. Role changes work without it.
        </div>
      )}

      <section className="mt-6 rounded-lg border border-[#1E2635] bg-[#121826] p-4">
        <div className="text-[13px] font-medium text-[#E7ECF3]">Invite someone</div>
        <div className="mt-3"><InviteForm canSuperAdmin={canSuperAdmin} disabled={!authReady} /></div>
      </section>

      <section className="mt-6 overflow-x-auto rounded-lg border border-[#1E2635]">
        <table className="w-full text-[12px]">
          <thead className="bg-[#0F1522] text-left text-[11px] uppercase tracking-wide text-[#64748B]">
            <tr><th className="px-3 py-2">User</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Since</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={`border-t border-[#1E2635] align-top ${u.disabled_at ? "opacity-50" : ""}`}>
                <td className="px-3 py-2">
                  <div className="font-medium text-[#E7ECF3]">{u.full_name ?? u.email}{u.id === user.id && <span className="ml-2 text-[11px] text-[#64748B]">(you)</span>}</div>
                  <div className="text-[11px] text-[#8B95A7]">{u.email}{u.consultant_name ? ` · consultant: ${u.consultant_name}` : ""}{u.disabled_at ? ` · removed ${new Date(u.disabled_at).toLocaleDateString()}` : ""}</div>
                </td>
                <td className="px-3 py-2 text-[#C3CCDB]"><div>{u.role.replace("_", " ")}</div><div className="max-w-xs text-[11px] text-[#64748B]">{ROLE_HELP[u.role]}</div></td>
                <td className="px-3 py-2 text-[#8B95A7]">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="px-3 py-2"><UserControls id={u.id} role={u.role} isSelf={u.id === user.id} canSuperAdmin={canSuperAdmin} disabledAt={u.disabled_at} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
