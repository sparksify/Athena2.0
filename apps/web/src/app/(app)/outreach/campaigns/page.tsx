import { supabaseServer } from "@/lib/supabase/server";
import {
  CampaignControls, MailboxControls, NewCampaignForm, NewMailboxForm, SuppressForm,
} from "./forms";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // draft batches call the LLM per candidate
export const metadata = { title: "Campaigns — Athena" };

const CAMPAIGN_TONE: Record<string, string> = {
  draft: "bg-[#1B2333] text-[#8B95A7]",
  active: "bg-emerald-500/15 text-emerald-400",
  paused: "bg-amber-500/15 text-amber-400",
  done: "bg-sky-500/15 text-sky-400",
};
const MAILBOX_TONE: Record<string, string> = {
  warming: "bg-amber-500/15 text-amber-400",
  active: "bg-emerald-500/15 text-emerald-400",
  paused: "bg-[#1B2333] text-[#8B95A7]",
};

export default async function CampaignsPage() {
  const supabase = await supabaseServer();
  const [{ data: campaigns }, { data: memberships }, { data: mailboxes }, { data: recentSuppressions }, { count: suppressionCount }] =
    await Promise.all([
      supabase.from("campaign").select("id, name, status, cohort_definition, created_at").order("created_at", { ascending: false }),
      supabase.from("campaign_membership").select("campaign_id, status"),
      supabase.from("mailbox").select("id, address, daily_cap, status, external_ref").order("address"),
      supabase.from("suppression").select("identifier, reason, source, created_at").order("created_at", { ascending: false }).limit(8),
      supabase.from("suppression").select("id", { count: "exact", head: true }),
    ]);

  const memberCounts = new Map<string, Record<string, number>>();
  for (const m of memberships ?? []) {
    const rec = memberCounts.get(m.campaign_id) ?? {};
    rec[m.status] = (rec[m.status] ?? 0) + 1;
    memberCounts.set(m.campaign_id, rec);
  }

  return (
    <main className="mx-auto max-w-6xl p-8">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Campaigns</h1>
          <p className="mt-1 text-sm text-[#8B95A7]">
            Cohort → AI drafts → <a href="/outreach" className="text-indigo-400 hover:underline">human approval</a> → gated sends through the mailbox pool.
          </p>
        </div>
        <a href="/outreach" className="text-sm text-indigo-400 underline-offset-4 hover:underline">
          Approval queue →
        </a>
      </div>

      <section className="mt-6 rounded-xl border border-[#1E2635] bg-[#121826] p-5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">Campaigns</h2>
        <div className="mt-3">
          <NewCampaignForm />
        </div>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-[#64748B]">
              <th className="pb-2 font-semibold">Campaign</th>
              <th className="pb-2 font-semibold">Status</th>
              <th className="pb-2 font-semibold">Pending</th>
              <th className="pb-2 font-semibold">Drafted</th>
              <th className="pb-2 font-semibold">Sent</th>
              <th className="pb-2 font-semibold">Replied</th>
              <th className="pb-2 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(campaigns ?? []).map((c) => {
              const m = memberCounts.get(c.id) ?? {};
              return (
                <tr key={c.id} className="border-t border-[#1A2130]" style={{ fontVariantNumeric: "tabular-nums" }}>
                  <td className="py-2.5">
                    <span className="block text-[#E7ECF3]">{c.name}</span>
                    <span className="text-[11px] text-[#64748B]">
                      min score {(c.cohort_definition as { minScore?: number })?.minScore ?? "—"}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${CAMPAIGN_TONE[c.status]}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="py-2.5">{m.pending ?? 0}</td>
                  <td className="py-2.5">{m.drafted ?? 0}</td>
                  <td className="py-2.5">{m.sent ?? 0}</td>
                  <td className="py-2.5">{m.replied ?? 0}</td>
                  <td className="py-2.5 text-right">
                    <CampaignControls id={c.id} status={c.status} />
                  </td>
                </tr>
              );
            })}
            {(campaigns ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="py-3 text-sm text-[#64748B]">
                  No campaigns yet. Create one above — it enrolls every non-suppressed candidate at or
                  above the score floor.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-xl border border-[#1E2635] bg-[#121826] p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">
            Mailbox pool
          </h2>
          <div className="mt-3">
            <NewMailboxForm />
          </div>
          <ul className="mt-4 space-y-2 text-sm">
            {(mailboxes ?? []).map((mb) => (
              <li key={mb.id} className="flex items-center justify-between rounded-lg border border-[#1E2635] bg-[#0F1522] px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[#E7ECF3]">{mb.address}</span>
                  <span className="text-[11px] text-[#64748B]" style={{ fontVariantNumeric: "tabular-nums" }}>
                    cap {mb.daily_cap}/day{mb.external_ref ? ` · ref ${mb.external_ref}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${MAILBOX_TONE[mb.status]}`}>
                    {mb.status}
                  </span>
                  <MailboxControls id={mb.id} status={mb.status} />
                </span>
              </li>
            ))}
            {(mailboxes ?? []).length === 0 && (
              <li className="text-sm text-[#64748B]">
                No mailboxes registered. Add the Smartlead pool addresses here; only <em>active</em>{" "}
                mailboxes under their daily cap ever send.
              </li>
            )}
          </ul>
        </section>

        <section className="rounded-xl border border-[#1E2635] bg-[#121826] p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">
            Suppression list · {suppressionCount ?? 0} total
          </h2>
          <p className="mt-1 text-xs text-[#64748B]">
            The hard gate. Checked in code before every send; opt-outs, bounces, and complaints land
            here automatically.
          </p>
          <div className="mt-3">
            <SuppressForm />
          </div>
          <ul className="mt-4 space-y-1.5 text-xs">
            {(recentSuppressions ?? []).map((s) => (
              <li key={`${s.identifier}-${s.created_at}`} className="flex items-center justify-between border-b border-[#1A2130] py-1.5 last:border-0">
                <span className="truncate font-mono text-[#A9B4C6]">{s.identifier}</span>
                <span className="shrink-0 text-[#64748B]">
                  {s.reason} · {s.source ?? "—"}
                </span>
              </li>
            ))}
            {(recentSuppressions ?? []).length === 0 && <li className="text-[#64748B]">Empty — fills with the Athena 1.0 import.</li>}
          </ul>
        </section>
      </div>
    </main>
  );
}
