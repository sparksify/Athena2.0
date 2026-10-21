import { sql } from "drizzle-orm";
import { getDb } from "@athena/db";
import { crmLookupScope } from "@athena/core";
import { supabaseServer } from "@/lib/supabase/server";
import { AnthropicProvider } from "@athena/llm-anthropic";
import { GhlAgencyReader, GhlCrmAdapter, type GhlAgency } from "@athena/crm-ghl";
import { ghlAgency, ghlAppConfigured } from "@/lib/ghl";
import { SmartleadProvider } from "@athena/email-smartlead";
import { MillionVerifierProvider } from "@athena/verify-millionverifier";
import { GmailProvider } from "@athena/email-gmail";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connections — Athena" };

/**
 * Live wiring check for every vendor on the launch path. Each row makes one
 * cheap, read-only call with the production credentials and reports what
 * came back — never the credential itself. A one-line summary goes to the
 * server log so the result is readable from Vercel without a login.
 */

type Status = "ok" | "warn" | "fail" | "off";
interface Check { name: string; status: Status; detail: string; next?: string; action?: { href: string; label: string } }

const rows = <T,>(r: unknown): T[] => (Array.isArray(r) ? (r as T[]) : ((r as { rows?: T[] }).rows ?? []));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const withTimeout = <T,>(p: Promise<T>, ms = 12_000): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms / 1000}s`)), ms))]);

/** Host and user of a Postgres URL, for diagnostics. Never the password. */
function describeDbUrl(url: string | undefined): string {
  if (!url) return "not set";
  try { const u = new URL(url); return `${u.username || "?"}@${u.hostname}:${u.port || "5432"}`; } catch { return "unparseable URL"; }
}

async function checkDatabase(): Promise<Check & { orgId?: string }> {
  if (!process.env.DATABASE_URL) return { name: "Database", status: "fail", detail: "DATABASE_URL is not set", next: "Add the Supabase transaction-pooler connection string." };
  try {
    const db = getDb();
    const r = rows<{ candidates: number; org_id: string | null }>(await withTimeout(db.execute(sql`
      select (select count(*)::int from candidate) as candidates, (select id::text from org order by created_at limit 1) as org_id`)));
    const row = r[0];
    return { name: "Database", status: "ok", detail: `${describeDbUrl(process.env.DATABASE_URL)} · ${row?.candidates ?? 0} candidates`, orgId: row?.org_id ?? undefined };
  } catch (e) {
    return { name: "Database", status: "fail", detail: `${describeDbUrl(process.env.DATABASE_URL)} · ${msg(e)}`,
      next: "Use the Supabase pooler string: postgres://postgres.<ref>:<password>@aws-N-<region>.pooler.supabase.com:6543/postgres" };
  }
}

async function checkAnthropic(): Promise<Check> {
  if (!process.env.ANTHROPIC_API_KEY) return { name: "Anthropic (drafting, classification, research)", status: "fail", detail: "ANTHROPIC_API_KEY is not set" };
  try {
    const r = await withTimeout(new AnthropicProvider().ping());
    return { name: "Anthropic (drafting, classification, research)", status: "ok", detail: `authenticated · newest model ${r.model}${process.env.ANTHROPIC_WORKSPACE_ID ? " · workspace header set" : ""}` };
  } catch (e) { return { name: "Anthropic (drafting, classification, research)", status: "fail", detail: msg(e) }; }
}

async function checkGhl(orgId?: string): Promise<Check[]> {
  const out: Check[] = [];
  const connect = { href: "/api/integrations/crm/connect", label: "Connect GoHighLevel" };
  let agency: GhlAgency | null = null;
  if (!ghlAppConfigured()) {
    out.push({ name: "GoHighLevel app", status: "off", detail: "GHL_CLIENT_ID / GHL_CLIENT_SECRET not set", next: "Register the Athena app in GHL's developer portal (see runbook), add the client id and secret, then connect." });
  } else {
    const a = orgId ? await ghlAgency(orgId).catch(() => null) : null;
    if (a) {
      agency = { agencyToken: a.agencyToken, companyId: a.companyId };
      const hours = a.expiresAt ? Math.max(0, Math.round((a.expiresAt.getTime() - Date.now()) / 3_600_000)) : null;
      const scopes = (a.scope ?? "").split(/\s+/).filter(Boolean);
      const hasOauth = scopes.includes("oauth.write");
      out.push({ name: "GoHighLevel app", status: hasOauth || !scopes.length ? "ok" : "warn",
        detail: `installed on agency ${a.companyId ?? "?"} · token ${hours == null ? "no expiry" : `refreshes in ${hours}h`} · ${scopes.length} scopes${scopes.length && !hasOauth ? " (oauth.write missing)" : ""}`,
        next: scopes.length && !hasOauth ? "Add the oauth.write scope to the app in GHL's developer portal and reconnect." : undefined, action: { href: connect.href, label: "Reconnect" } });
    } else {
      out.push({ name: "GoHighLevel app", status: "fail", detail: "app configured but not installed on the agency yet", next: "Click Connect, pick the FCC agency, allow all sub-accounts.", action: connect });
    }
  }
  if (!process.env.GHL_API_KEY && !agency) return [...out, { name: "GoHighLevel", status: "fail", detail: "no GHL_API_KEY and the app is not connected" }];
  let locations: { id: string; name: string | null }[];
  try {
    const scopeRefs = orgId && process.env.DATABASE_URL ? await crmLookupScope(getDb(), orgId).catch(() => [] as { id: string; token: string | null }[]) : [];
    const reader = await withTimeout(GhlAgencyReader.scoped(scopeRefs, { agencyToken: agency?.agencyToken, companyId: agency?.companyId ?? undefined }));
    locations = await reader.listLocations();
    const wide = reader.scope === "all" && reader.total > 25;
    out.push({ name: "GoHighLevel sub-accounts", status: reader.total ? (wide ? "warn" : "ok") : "warn",
      detail: reader.total
        ? `${reader.total} visible · lookups search ${reader.scope === "all" ? "all of them" : `${locations.length}: ${locations.map((l) => l.name ?? l.id).join(", ")}`}`
        : "agency token works but no sub-accounts came back",
      next: !reader.total ? "Check GHL_COMPANY_ID is the agency id."
        : wide ? "Match consultants to their sub-accounts and set GHL_LOCATION_IDS (ids or names) to the central accounts that hold lead history; searching every sub-account per candidate is too slow." : undefined });
  } catch (e) {
    return [{ name: "GoHighLevel sub-accounts", status: "fail", detail: msg(e), next: "GHL_API_KEY must be an agency-level token and GHL_COMPANY_ID the agency id." }];
  }
  if (orgId && process.env.DATABASE_URL) {
    try {
      const r = rows<{ matched: number; total: number; tokens: number }>(await getDb().execute(sql`
        select count(*) filter (where c.ghl_ref is not null)::int as matched, count(*)::int as total,
          count(*) filter (where s.ghl_token is not null)::int as tokens
        from consultant c left join consultant_secret s on s.consultant_id = c.id where c.org_id = ${orgId} and c.status = 'active'`));
      const { matched = 0, total = 0, tokens = 0 } = r[0] ?? {};
      out.push({ name: "Consultants matched to sub-accounts", status: matched === total && total > 0 ? "ok" : matched ? "warn" : "fail", detail: `${matched} of ${total} active consultants have a sub-account · ${tokens} with their own token`,
        next: matched === total ? undefined : "Roster → “Sync from GHL”, then pick any leftovers from the sub-account list." });
    } catch (e) { out.push({ name: "Consultants matched to sub-accounts", status: "fail", detail: msg(e) }); }
  }
  if (orgId && process.env.DATABASE_URL) {
    const cons = rows<{ id: string; name: string; ghl_ref: string; ghl_pipeline: string | null; ghl_token: string | null }>(await getDb().execute(sql`
      select c.id, c.name, c.ghl_ref, c.ghl_pipeline, s.ghl_token from consultant c left join consultant_secret s on s.consultant_id = c.id
      where c.org_id = ${orgId} and c.status = 'active' and c.ghl_ref is not null order by c.name`));
    const results = await Promise.all(cons.map(async (c) => {
      try {
        const r = await withTimeout(new GhlCrmAdapter({ agencyToken: agency?.agencyToken, companyId: agency?.companyId ?? undefined }).forLocation(c.ghl_ref, c.ghl_token, c.ghl_pipeline).checkPipeline());
        return { c, ...r, error: null as string | null };
      } catch (e) { return { c, matched: null, available: [] as string[], defaulted: false, error: msg(e) }; }
    }));
    const ok = results.filter((r) => r.matched);
    const missing = results.filter((r) => !r.matched);
    out.push({ name: "GoHighLevel pipeline per consultant", status: !results.length ? "warn" : missing.length === 0 ? "ok" : ok.length ? "warn" : "fail",
      detail: `${ok.length} of ${results.length} consultants have a pipeline for the mirror` +
        (ok.length ? ` · ${ok.map((r) => `${r.c.name}: ${r.matched}${r.defaulted ? " (only one)" : ""}`).join("; ")}` : "") +
        (missing.length ? ` · needs a choice: ${missing.map((r) => `${r.c.name}${r.error ? ` (${r.error})` : ` (has: ${r.available.join(", ") || "none"})`}`).join("; ")}` : ""),
      next: missing.length ? "Roster → edit the consultant → “GHL pipeline for new opportunities”. Sub-accounts with a single pipeline need nothing." : undefined });
  }
  return out;
}

async function checkSmartlead(orgId?: string): Promise<Check[]> {
  if (!process.env.SMARTLEAD_API_KEY || !process.env.SMARTLEAD_API_CAMPAIGN_ID) return [{ name: "Smartlead (cold email)", status: "fail", detail: "SMARTLEAD_API_KEY / SMARTLEAD_API_CAMPAIGN_ID not set" }];
  const out: Check[] = [];
  try {
    const c = await withTimeout(new SmartleadProvider().describeCampaign());
    out.push({ name: "Smartlead (cold email)", status: c.emailAccounts ? "ok" : "warn", detail: `campaign “${c.name ?? "?"}” (${c.status ?? "?"}) · ${c.emailAccounts} sending accounts attached`,
      next: c.emailAccounts ? undefined : "Attach the warmed mailboxes to this campaign in Smartlead." });
  } catch (e) { out.push({ name: "Smartlead (cold email)", status: "fail", detail: msg(e) }); }
  if (orgId && process.env.DATABASE_URL) {
    try {
      const r = rows<{ active: number; total: number }>(await getDb().execute(sql`
        select count(*) filter (where status = 'active')::int as active, count(*)::int as total from mailbox where org_id = ${orgId} and provider = 'smartlead'`));
      const { active = 0, total = 0 } = r[0] ?? {};
      out.push({ name: "Mailbox pool in Athena", status: active ? "ok" : "fail", detail: `${active} active of ${total} Smartlead mailboxes registered`,
        next: active ? undefined : "Outreach → Campaigns & mailboxes: add each sending address with its Smartlead email-account id, then set it active. The scheduler sends nothing until one exists." });
    } catch (e) { out.push({ name: "Mailbox pool in Athena", status: "fail", detail: msg(e) }); }
  }
  out.push({ name: "Smartlead reply webhook", status: process.env.SMARTLEAD_WEBHOOK_SECRET ? "ok" : "warn",
    detail: process.env.SMARTLEAD_WEBHOOK_SECRET ? "signature secret set" : "SMARTLEAD_WEBHOOK_SECRET not set — webhook accepts unsigned posts",
    next: "Point Smartlead’s campaign webhooks (reply, bounce, unsubscribe) at /api/webhooks/smartlead." });
  return out;
}

async function checkVerifier(): Promise<Check> {
  if (!process.env.MILLIONVERIFIER_API_KEY) return { name: "MillionVerifier (send gate)", status: "fail", detail: "MILLIONVERIFIER_API_KEY not set — nothing can be sent until addresses verify" };
  try {
    const credits = await withTimeout(new MillionVerifierProvider().credits());
    return { name: "MillionVerifier (send gate)", status: credits > 0 ? "ok" : "warn", detail: `${credits.toLocaleString()} credits remaining`, next: credits > 0 ? undefined : "Top up credits; every new address is verified once." };
  } catch (e) { return { name: "MillionVerifier (send gate)", status: "fail", detail: msg(e) }; }
}

async function checkPersona(orgId?: string): Promise<Check> {
  const configured = GmailProvider.configured();
  let addresses = 0;
  if (orgId && process.env.DATABASE_URL) {
    try { addresses = rows<{ n: number }>(await getDb().execute(sql`select count(*)::int as n from persona_mailbox where org_id = ${orgId} and active and address is not null`))[0]?.n ?? 0; } catch { /* reported by the DB row */ }
  }
  if (!configured) return { name: "Coordinator persona (Gmail)", status: "off", detail: "GMAIL_SERVICE_ACCOUNT_JSON not set — warm intros are drafted but not sent", next: "Needed before Phase 7 intros go out, not before the first cold sends." };
  return { name: "Coordinator persona (Gmail)", status: addresses ? "ok" : "warn", detail: `service account set · ${addresses} persona addresses on the roster`, next: addresses ? undefined : "Roster → give Tim/Sophie/Claire/Rina their addresses on the persona domain." };
}

function envFlag(name: string, key: string, why: string, soft = false): Check {
  const set = Boolean(process.env[key]);
  return { name, status: set ? "ok" : soft ? "off" : "warn", detail: set ? `${key} set` : `${key} not set`, next: set ? undefined : why };
}

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ ghl?: string; reason?: string }> }) {
  const sp = await searchParams;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = user ? await supabase.from("user").select("role").eq("id", user.id).single() : { data: null };
  if (!["super_admin", "fcc_admin", "manager"].includes(me?.role ?? "")) {
    return <main className="p-6 text-sm text-[#8B95A7]">Managers and admins see connections.</main>;
  }

  const database = await checkDatabase();
  const [anthropic, ghl, smartlead, verifier, persona] = await Promise.all([
    checkAnthropic(), checkGhl(database.orgId), checkSmartlead(database.orgId), checkVerifier(), checkPersona(database.orgId),
  ]);
  const checks: Check[] = [
    database, anthropic, ...ghl, ...smartlead, verifier, persona,
    envFlag("Cron protection", "CRON_SECRET", "Vercel sends it automatically once set; without it anyone can trigger a tick (harmless, but noisy)."),
    envFlag("GHL webhooks", "GHL_WEBHOOK_SECRET", "Set, then add the same value to the GHL webhook so stage changes and SMS replies are trusted."),
    envFlag("Manager escalation SMS", "MANAGER_SMS_TO", "The +24h nudge goes to this number when a consultant stays silent."),
    envFlag("Calendly webhooks", "CALENDLY_WEBHOOK_SIGNING_KEY", "Needed when appointments start flowing (Phase 7).", true),
    envFlag("Public URL", "APP_URL", "Links in intros fall back to the Vercel URL; set when a custom domain exists.", true),
  ];

  console.info("[connections]", JSON.stringify(checks.map((c) => ({ n: c.name, s: c.status, d: c.detail.slice(0, 160) }))));

  const tone: Record<Status, string> = { ok: "text-green-400", warn: "text-amber-400", fail: "text-red-400", off: "text-[#64748B]" };
  const label: Record<Status, string> = { ok: "OK", warn: "Attention", fail: "Failing", off: "Not yet" };
  const failing = checks.filter((c) => c.status === "fail").length;

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">Connections</h1>
      <p className="mt-1 text-sm text-[#8B95A7]">
        Live checks against production credentials. {failing === 0 ? "Everything on the launch path answers." : `${failing} blocking.`} Reload to re-run.
      </p>
      {sp.ghl === "connected" && <p className="mt-3 rounded-md border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300">GoHighLevel app installed on the agency.</p>}
      {sp.ghl === "error" && <p className="mt-3 rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">GoHighLevel install failed: {sp.reason ?? "unknown"}</p>}
      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[#1E2635] text-left text-[#8B95A7]">
            <th className="py-2 pr-4 font-medium">Service</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 font-medium">What we saw</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c) => (
            <tr key={c.name} className="border-b border-[#1A2130] align-top">
              <td className="py-2 pr-4 whitespace-nowrap">{c.name}</td>
              <td className={`py-2 pr-4 whitespace-nowrap ${tone[c.status]}`}>{label[c.status]}</td>
              <td className="py-2 text-[#C3CCDB]">
                <div>{c.detail}</div>
                {c.next && c.status !== "ok" && <div className="mt-1 text-xs text-[#8B95A7]">→ {c.next}</div>}
                {c.action && <a href={c.action.href} className="mt-1 inline-block rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500">{c.action.label}</a>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
