import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { RouteButton } from "./route-button";

export const dynamic = "force-dynamic";

type Factor = { factor: string; points: number; reason: string };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[#1E2635] bg-[#121826] p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-[#8B95A7]">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default async function Candidate360({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: candidate } = await supabase
    .from("candidate")
    .select("*")
    .eq("id", id)
    .single();
  if (!candidate) notFound();

  const [
    { data: snapshots },
    { data: identifiers },
    { data: attributes },
    { data: financials },
    { data: questionnaires },
    { data: interactions },
    { data: links },
    { data: events },
    { data: assignments },
    { data: me },
  ] = await Promise.all([
    supabase.from("score_snapshot").select("score, version, factors, created_at").eq("candidate_id", id).order("created_at", { ascending: false }).limit(1),
    supabase.from("identifier").select("type, value_normalized, email_verification(result, checked_at)").eq("candidate_id", id),
    supabase.from("candidate_attribute").select("key, value, confidence, created_at").eq("candidate_id", id).is("superseded_by_id", null),
    supabase.from("financial_profile").select("liquidity_usd, net_worth_usd, investable_usd").eq("candidate_id", id),
    supabase.from("questionnaire").select("kind, completed_at").eq("candidate_id", id),
    supabase.from("interaction").select("type, direction, occurred_at, payload").eq("candidate_id", id).order("occurred_at", { ascending: false }).limit(50),
    supabase.from("candidate_source_link").select("method, confidence, source_record(source_type, imported_at, source_batch_id)").eq("candidate_id", id),
    supabase.from("event").select("type, created_at").eq("entity_id", id).order("created_at", { ascending: false }).limit(25),
    supabase.from("assignment").select("id, status, offered_at, first_touch_at, consultant(name), persona_mailbox(name)").eq("candidate_id", id).order("offered_at", { ascending: false }).limit(3),
    supabase.from("user").select("role").eq("id", user.id).single(),
  ]);
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const live = (assignments ?? []).find((a) => a.status === "offered" || a.status === "accepted") ?? null;
  const lastAssignment = assignments?.[0] ?? null;
  const canRoute = ["super_admin", "fcc_admin", "manager"].includes(me?.role ?? "") && !live && Boolean(process.env.DATABASE_URL);

  const snapshot = snapshots?.[0];
  const factors = (snapshot?.factors ?? []) as Factor[];
  const fin = financials?.[0]; // absent entirely for consultant role (RLS)
  const money = (v: unknown) => (v == null ? "—" : `$${Math.round(Number(v) / 1000)}k`);

  const attr = (k: string) => (attributes ?? []).find((a) => a.key === k)?.value as unknown;
  const crm = attr("crm_contact_id")
    ? {
        stage: attr("crm_stage") as string | null, status: attr("crm_opportunity_status") as string | null, pipeline: attr("crm_pipeline") as string | null,
        tags: (attr("crm_tags") as string[] | undefined) ?? [], source: attr("crm_source") as string | null, assignedTo: attr("crm_assigned_to") as string | null,
        lastContact: attr("crm_last_contact_at") as string | null, messagesIn: Number(attr("crm_messages_in") ?? 0), messagesOut: Number(attr("crm_messages_out") ?? 0),
        appointments: Number(attr("crm_appointments") ?? 0), dnd: Boolean(attr("crm_dnd")), notes: attr("crm_notes") as string | null, value: attr("crm_opportunity_value_usd") as number | null,
      }
    : null;
  const research = attr("research_note")
    ? { note: String(attr("research_note")), sources: (attr("research_sources") as string[] | undefined) ?? [], signals: (attr("research_signals") as string[] | undefined) ?? [], role: attr("current_role") as string | null, company: attr("current_company") as string | null }
    : null;
  const HIDE = new Set(["crm_contact_id", "crm_tags", "crm_source", "crm_added_at", "crm_assigned_to", "crm_dnd", "crm_pipeline", "crm_stage", "crm_opportunity_status", "crm_opportunity_value_usd", "crm_opportunity_count", "crm_last_contact_at", "crm_messages_in", "crm_messages_out", "crm_appointments", "crm_notes", "crm_custom_fields", "research_note", "research_sources", "research_signals", "current_role", "current_company"]);
  const plainAttributes = (attributes ?? []).filter((a) => !HIDE.has(a.key));

  const nextAction =
    candidate.status !== "new" && candidate.status !== "scored"
      ? `in flight — status ${candidate.status}`
      : (candidate.current_score ?? 0) >= 80
        ? "strong reactivation candidate — queue for outreach when Phase 5 goes live"
        : (candidate.current_score ?? 0) >= 60
          ? "worth outreach in a later cohort"
          : "hold — low score; revisit after enrichment or new signals";

  return (
    <main className="mx-auto max-w-5xl p-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{candidate.full_name ?? "Unnamed candidate"}</h1>
          <p className="mt-1 text-sm text-[#8B95A7]">
            {[candidate.primary_email, candidate.primary_phone, [candidate.city, candidate.state].filter(Boolean).join(", ")]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#8B95A7]">
            {live ? (
              <span>
                Assigned to <span className="text-[#E7ECF3]">{one(live.consultant)?.name ?? "consultant"}</span>
                {one(live.persona_mailbox)?.name ? ` by ${one(live.persona_mailbox)!.name}` : ""} · {live.status}
                {live.first_touch_at ? " · first contact made" : " · awaiting first contact"}
              </span>
            ) : lastAssignment ? (
              <span>Last assignment: {one(lastAssignment.consultant)?.name ?? "consultant"} · {lastAssignment.status.replace("_", " ")}</span>
            ) : (
              <span>Not routed to a consultant</span>
            )}
            {canRoute && <RouteButton candidateId={id} />}
            {live && <a className="text-indigo-300 hover:underline" href={`/consultants/queue?assignment=${live.id}`}>open in queue</a>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-4xl font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>
            {candidate.current_score ?? "—"}
          </div>
          <div className="text-xs text-[#8B95A7]">reactivation score</div>
          <span className="mt-1 inline-block rounded-full bg-[#1B2333] px-2 py-0.5 font-mono text-xs">
            {candidate.status}
          </span>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Why we care">
          {factors.length === 0 ? (
            <p className="text-sm text-[#64748B]">Not scored yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {factors.map((f) => (
                  <tr key={f.factor} className="border-b border-[#161D2B] last:border-0">
                    <td className="py-1 pr-2 font-mono text-xs text-[#8B95A7]">{f.factor}</td>
                    <td className={`w-10 py-1 text-right font-mono text-xs ${f.points > 0 ? "text-green-400" : f.points < 0 ? "text-red-400" : "text-[#64748B]"}`}
                        style={{ fontVariantNumeric: "tabular-nums" }}>
                      {f.points > 0 ? `+${f.points}` : f.points}
                    </td>
                    <td className="py-1 pl-3 text-[#A9B4C6]">{f.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="What we know">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {fin && (
              <>
                <dt className="text-[#8B95A7]">Liquidity</dt>
                <dd className="font-mono">{money(fin.liquidity_usd)}</dd>
                <dt className="text-[#8B95A7]">Net worth</dt>
                <dd className="font-mono">{money(fin.net_worth_usd)}</dd>
              </>
            )}
            <dt className="text-[#8B95A7]">Questionnaire</dt>
            <dd>{questionnaires?.length ? questionnaires.map((q) => q.kind).join(", ") : "none"}</dd>
            {(identifiers ?? []).map((i, idx) => {
              const ver = (i.email_verification as { result: string }[] | null)?.[0];
              return (
                <div key={idx} className="col-span-2 flex justify-between border-t border-[#161D2B] pt-1">
                  <span className="font-mono text-xs">{i.value_normalized}</span>
                  <span className="text-xs text-[#8B95A7]">
                    {i.type}{ver ? ` · ${ver.result}` : i.type === "email" ? " · unverified" : ""}
                  </span>
                </div>
              );
            })}
            {plainAttributes.map((a) => (
              <div key={a.key} className="col-span-2 flex justify-between border-t border-[#161D2B] pt-1">
                <span className="text-[#8B95A7]">{a.key}</span>
                <span className="max-w-64 truncate text-right">{JSON.stringify(a.value)}</span>
              </div>
            ))}
          </dl>
        </Section>

        <Section title="In the CRM">
          {!crm ? (
            <p className="text-sm text-[#64748B]">{attr("crm_contact_id") === undefined && (events ?? []).some((e) => e.type === "candidate.crm_checked") ? "Not in GoHighLevel." : "CRM lookup pending (runs within 10 minutes of import)."}</p>
          ) : (
            <div className="text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {crm.stage && <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-xs text-indigo-300">{crm.stage}</span>}
                {crm.status && <span className={`rounded-full px-2 py-0.5 text-xs ${crm.status === "open" ? "bg-emerald-500/15 text-emerald-300" : crm.status === "won" ? "bg-amber-500/15 text-amber-300" : "bg-[#1B2333] text-[#8B95A7]"}`}>{crm.status}{crm.value ? ` · $${Number(crm.value).toLocaleString()}` : ""}</span>}
                {crm.dnd && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-300">do not disturb</span>}
                {crm.tags.map((t) => <span key={t} className="rounded-full border border-[#2A3447] px-2 py-0.5 text-xs text-[#C3CCDB]">{t}</span>)}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-[#8B95A7]">Pipeline</dt><dd>{crm.pipeline ?? "—"}</dd>
                <dt className="text-[#8B95A7]">Source</dt><dd>{crm.source ?? "—"}</dd>
                <dt className="text-[#8B95A7]">Assigned to</dt><dd>{crm.assignedTo ?? "—"}</dd>
                <dt className="text-[#8B95A7]">Last contact</dt><dd>{crm.lastContact ? new Date(crm.lastContact).toLocaleDateString() : "—"}</dd>
                <dt className="text-[#8B95A7]">Messages</dt><dd>{crm.messagesOut} sent · {crm.messagesIn} received</dd>
                <dt className="text-[#8B95A7]">Appointments</dt><dd>{crm.appointments}</dd>
              </dl>
              {crm.notes && <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-[#161D2B] bg-[#0F1522] p-3 text-xs leading-relaxed text-[#C3CCDB]">{crm.notes}</pre>}
            </div>
          )}
        </Section>

        <Section title="Research">
          {!research ? (
            <p className="text-sm text-[#64748B]">{(candidate.current_score ?? 0) >= 70 ? "Research queued; a sourced note lands within the next cycle." : "Research runs for candidates scoring 70 and above."}</p>
          ) : (
            <div className="text-sm">
              {(research.role || research.company) && <div className="text-[#E7ECF3]">{[research.role, research.company].filter(Boolean).join(" · ")}</div>}
              <p className="mt-1 leading-relaxed text-[#C3CCDB]">{research.note}</p>
              {research.signals.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{research.signals.map((x) => <span key={x} className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-300">{x}</span>)}</div>}
              {research.sources.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs">
                  {research.sources.map((u) => <li key={u}><a href={u} target="_blank" rel="noreferrer" className="text-indigo-300 hover:underline">{u.replace(/^https?:\/\//, "").slice(0, 80)}</a></li>)}
                </ul>
              )}
            </div>
          )}
        </Section>

        <Section title="What happened">
          {(interactions ?? []).length === 0 && (links ?? []).length === 0 ? (
            <p className="text-sm text-[#64748B]">No history yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {(interactions ?? []).map((i, idx) => (
                <li key={idx} className="flex justify-between border-b border-[#161D2B] py-1 last:border-0">
                  <span className="font-mono text-xs">{i.direction === "inbound" ? "←" : "→"} {i.type}</span>
                  <span className="text-xs text-[#64748B]">{new Date(i.occurred_at).toLocaleDateString()}</span>
                </li>
              ))}
              {(links ?? []).map((l, idx) => {
                const raw = l.source_record as unknown;
                const sr = (Array.isArray(raw) ? raw[0] : raw) as
                  | { source_type: string; imported_at: string }
                  | null;
                return (
                  <li key={`s${idx}`} className="flex justify-between border-b border-[#161D2B] py-1 last:border-0">
                    <span className="text-[#A9B4C6]">
                      source record: <span className="font-mono text-xs">{sr?.source_type}</span>
                      <span className="ml-1 text-xs text-[#64748B]">({l.method}, {Number(l.confidence).toFixed(2)})</span>
                    </span>
                    <span className="text-xs text-[#64748B]">
                      {sr ? new Date(sr.imported_at).toLocaleDateString() : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="What happens next">
          <p className="text-sm">{nextAction}</p>
          <p className="mt-2 text-xs text-[#64748B]">
            AI research notes and outreach recommendations arrive with Phase 5.
          </p>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-[#8B95A7]">Recent events</h3>
          <ul className="mt-1 space-y-0.5 text-xs">
            {(events ?? []).map((e, idx) => (
              <li key={idx} className="flex justify-between py-0.5">
                <span className="font-mono">{e.type}</span>
                <span className="text-[#64748B]">{new Date(e.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </main>
  );
}
