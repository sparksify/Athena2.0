import { sql } from "drizzle-orm";
import { getDb } from "@athena/db";
import { supabaseServer } from "@/lib/supabase/server";
import { AnthropicProvider } from "@athena/llm-anthropic";
import { GhlCrmAdapter } from "@athena/crm-ghl";
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
interface Check { name: string; status: Status; detail: string; next?: string }

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
  if (!process.env.GHL_API_KEY) return [{ name: "GoHighLevel", status: "fail", detail: "GHL_API_KEY is not set" }];
  let locations: { id: string; name: string | null }[];
  try {
    locations = await withTimeout(GhlCrmAdapter.listLocations());
    out.push({ name: "GoHighLevel sub-accounts", status: locations.length ? "ok" : "warn",
      detail: locations.length ? `${locations.length} visible: ${locations.map((l) => l.name ?? l.id).join(", ")}` : "agency token works but no sub-accounts came back",
      next: locations.length ? undefined : "Check GHL_COMPANY_ID is the agency id." });
  } catch (e) {
    return [{ name: "GoHighLevel sub-accounts", status: "fail", detail: msg(e), next: "GHL_API_KEY must be an agency-level token and GHL_COMPANY_ID the agency id." }];
  }
  if (orgId && process.env.DATABASE_URL) {
    try {
      const r = rows<{ matched: number; total: number }>(await getDb().execute(sql`
        select count(*) filter (where ghl_ref is not null)::int as matched, count(*)::int as total from consultant where org_id = ${orgId} and status = 'active'`));
      const { matched = 0, total = 0 } = r[0] ?? {};
      out.push({ name: "Consultants matched to sub-accounts", status: matched === total && total > 0 ? "ok" : matched ? "warn" : "fail", detail: `${matched} of ${total} active consultants have a sub-account`,
        next: matched === total ? undefined : "Roster → “Match consultants to GHL sub-accounts”, then set any leftovers by hand." });
    } catch (e) { out.push({ name: "Consultants matched to sub-accounts", status: "fail", detail: msg(e) }); }
  }
  const ref = process.env.GHL_PIPELINE_ID ?? process.env.GHL_PIPELINE_NAME;
  if (!ref) out.push({ name: "GoHighLevel pipeline", status: "fail", detail: "GHL_PIPELINE_ID / GHL_PIPELINE_NAME not set" });
  else {
    const sample = locations.slice(0, 12);
    const results = await Promise.all(sample.map(async (l) => {
      try { const c = await withTimeout(new GhlCrmAdapter().forLocation(l.id).checkPipeline()); return { l, ...c, error: null as string | null }; }
      catch (e) { return { l, matched: null, available: [] as string[], error: msg(e) }; }
    }));
    const hits = results.filter((r) => r.matched);
    const misses = results.filter((r) => !r.matched);
    out.push({ name: "GoHighLevel pipeline", status: misses.length === 0 ? "ok" : hits.length ? "warn" : "fail",
      detail: `“${ref}” found in ${hits.length} of ${results.length} sub-accounts` + (misses.length ? ` · missing in ${misses.map((m) => `${m.l.name ?? m.l.id}${m.error ? ` (${m.error})` : m.available.length ? ` (has: ${m.available.join(", ")})` : ""}`).join("; ")}` : ""),
      next: misses.length ? "Pipeline ids differ per sub-account. Set GHL_PIPELINE_NAME to the pipeline’s name instead of GHL_PIPELINE_ID so every sub-account matches." : undefined });
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

export default async function ConnectionsPage() {
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
