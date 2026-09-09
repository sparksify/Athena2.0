import { sql } from "drizzle-orm";
import { getDb } from "@athena/db";
import { STAGE_LABELS, slaFor, type SlaState } from "@athena/core";
import { supabaseServer } from "@/lib/supabase/server";
import { SLA_LABEL } from "../demo-data";
import { DispositionControls, FirstTouchControls, OfferControls, TakeBackButton } from "./controls";

export const dynamic = "force-dynamic";
export const metadata = { title: "My queue — Athena" };

const SLA_TONE: Record<SlaState, string> = {
  on_track: "bg-emerald-500/15 text-emerald-300", nudged: "bg-amber-500/15 text-amber-300",
  escalated: "bg-orange-500/15 text-orange-300", take_back: "bg-red-500/15 text-red-300",
};
const rows = <T,>(r: unknown): T[] => (Array.isArray(r) ? (r as T[]) : ((r as { rows?: T[] }).rows ?? []));
const hrs = (from: Date, to = new Date()) => Math.max(0, Math.round((to.getTime() - from.getTime()) / 3_600_000));
const fmt = (d: Date) => d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

interface AssignmentRow {
  id: string; status: string; offered_at: string; first_touch_at: string | null; consultant: string; consultant_id: string;
  lead: string | null; email: string | null; phone: string | null; candidate_id: string; agent: string | null; stage: string | null; score: number | null; research: string | null;
}
interface ApptRow { id: string; lead: string | null; consultant: string; starts_at: string; ends_at: string; status: string; has_cq: boolean; has_disposition: boolean; kind: string }

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ assignment?: string }> }) {
  const { assignment: highlight } = await searchParams;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = user ? await supabase.from("user").select("role, org_id, full_name").eq("id", user.id).single() : { data: null };
  const manager = ["super_admin", "fcc_admin", "manager"].includes(me?.role ?? "");
  if (!process.env.DATABASE_URL || !me) {
    return <main className="p-6 text-sm text-[#8B95A7]">The queue needs a database connection (DATABASE_URL).</main>;
  }
  const db = getDb();
  const orgId = me.org_id as string;
  const scope = manager ? sql`` : sql`and c.user_id = ${user!.id}`;
  const [assignments, appts] = await Promise.all([
    rows<AssignmentRow>(await db.execute(sql`
      select a.id, a.status, a.offered_at, a.first_touch_at, c.name as consultant, c.id as consultant_id,
        cand.full_name as lead, cand.primary_email as email, cand.primary_phone as phone, cand.id as candidate_id, cand.current_score as score,
        p.name as agent, o.stage,
        (select ca.value #>> '{}' from candidate_attribute ca where ca.candidate_id = cand.id and ca.key = 'research_note' and ca.superseded_by_id is null order by ca.created_at desc limit 1) as research
      from assignment a
      join consultant c on c.id = a.consultant_id
      join candidate cand on cand.id = a.candidate_id
      left join persona_mailbox p on p.id = a.persona_mailbox_id
      left join opportunity o on o.candidate_id = a.candidate_id and o.stage not in ('closed_funded','closed_lost')
      where a.org_id = ${orgId} and a.status in ('offered','accepted') ${scope}
      order by a.offered_at desc`)),
    rows<ApptRow>(await db.execute(sql`
      select ap.id, cand.full_name as lead, c.name as consultant, ap.starts_at, ap.ends_at, ap.status, ap.kind,
        exists (select 1 from questionnaire q where q.candidate_id = ap.candidate_id and q.kind = 'cq_complete') as has_cq,
        exists (select 1 from disposition d where d.appointment_id = ap.id) as has_disposition
      from appointment ap join consultant c on c.id = ap.consultant_id join candidate cand on cand.id = ap.candidate_id
      where ap.org_id = ${orgId} and ap.status = 'scheduled' ${scope}
        and ap.starts_at >= now() - interval '14 days' and ap.starts_at <= now() + interval '14 days'
      order by ap.starts_at`)),
  ]);
  const now = new Date();
  const offered = assignments.filter((a) => a.status === "offered");
  const awaitingTouch = assignments.filter((a) => a.status === "accepted" && !a.first_touch_at);
  const working = assignments.filter((a) => a.first_touch_at);
  const awaitingDisposition = appts.filter((a) => new Date(a.ends_at) < now && !a.has_disposition);
  const upcoming = appts.filter((a) => new Date(a.starts_at) >= now);
  const sla = (a: AssignmentRow) => slaFor({ firstTouchAt: a.first_touch_at ? new Date(a.first_touch_at) : null, offeredAt: new Date(a.offered_at), status: a.status }, now);

  const Card = ({ a, children }: { a: AssignmentRow; children?: React.ReactNode }) => {
    const s = sla(a);
    return (
      <div className={`rounded-lg border ${highlight === a.id ? "border-indigo-500" : "border-[#1E2635]"} bg-[#121826] p-4`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <a href={`/candidates/${a.candidate_id}`} className="font-medium text-[#E7ECF3] hover:underline">{a.lead ?? "Unnamed"}</a>
              {a.score != null && <span className="rounded bg-indigo-500/15 px-1.5 text-[11px] text-indigo-300">score {a.score}</span>}
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${SLA_TONE[s]}`}>{SLA_LABEL[s]}</span>
            </div>
            <div className="mt-0.5 text-[12px] text-[#8B95A7]">
              {a.email ?? "no email"}{a.phone ? ` · ${a.phone}` : ""} · {a.stage ? STAGE_LABELS[a.stage as keyof typeof STAGE_LABELS] : "Lead In"}
              {manager && <> · <span className="text-[#C3CCDB]">{a.consultant}</span></>}
              {a.agent && <> · assigned by {a.agent}</>}
              {" · "}{hrs(new Date(a.offered_at))}h since assignment
            </div>
            {a.research && <div className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-[#C3CCDB]">{a.research}</div>}
          </div>
          <div className="flex flex-col items-end gap-1.5">{children}</div>
        </div>
      </div>
    );
  };
  const Section = ({ title, hint, count, children }: { title: string; hint: string; count: number; children: React.ReactNode }) => (
    <section className="mt-6">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#C3CCDB]">{title}</h2>
        <span className="text-[12px] text-[#64748B]">{count} · {hint}</span>
      </div>
      {count === 0 ? <div className="rounded-lg border border-dashed border-[#1E2635] px-4 py-3 text-[12px] text-[#64748B]">Nothing here.</div> : <div className="space-y-2">{children}</div>}
    </section>
  );

  return (
    <main className="p-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#E7ECF3]">{manager ? "Consultant work queue" : `Your queue, ${(me.full_name ?? "").split(" ")[0] || "there"}`}</h1>
          <p className="mt-1 text-[12px] text-[#8B95A7]">First contact within 48 hours or the lead is taken back and re-routed. Nudges at +1h, +4h, manager at +24h.</p>
        </div>
        <nav className="flex gap-3 text-[12px] text-[#8B95A7]"><a className="hover:text-[#E7ECF3]" href="/consultants">Command board</a>{manager && <a className="hover:text-[#E7ECF3]" href="/consultants/roster">Roster</a>}</nav>
      </div>

      <Section title="Offered to you" hint="accept to start, decline to re-route" count={offered.length}>
        {offered.map((a) => <Card key={a.id} a={a}><OfferControls assignmentId={a.id} />{manager && <TakeBackButton assignmentId={a.id} />}</Card>)}
      </Section>
      <Section title="Awaiting first contact" hint="the 48-hour clock is running" count={awaitingTouch.length}>
        {awaitingTouch.map((a) => <Card key={a.id} a={a}><FirstTouchControls assignmentId={a.id} />{manager && <TakeBackButton assignmentId={a.id} />}</Card>)}
      </Section>
      <Section title="Consults awaiting a disposition" hint="reply 1–4 by SMS or here" count={awaitingDisposition.length}>
        {awaitingDisposition.map((ap) => (
          <div key={ap.id} className="rounded-lg border border-[#1E2635] bg-[#121826] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><span className="font-medium text-[#E7ECF3]">{ap.lead ?? "Unnamed"}</span><span className="ml-2 text-[12px] text-[#8B95A7]">{fmt(new Date(ap.starts_at))}{manager ? ` · ${ap.consultant}` : ""} · {ap.kind}</span></div>
              <DispositionControls appointmentId={ap.id} />
            </div>
          </div>
        ))}
      </Section>
      <Section title="Upcoming consults" hint="CQ must be in hand before the consult" count={upcoming.length}>
        {upcoming.map((ap) => (
          <div key={ap.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#1E2635] bg-[#121826] px-4 py-2.5">
            <div><span className="font-medium text-[#E7ECF3]">{ap.lead ?? "Unnamed"}</span><span className="ml-2 text-[12px] text-[#8B95A7]">{fmt(new Date(ap.starts_at))}{manager ? ` · ${ap.consultant}` : ""}</span></div>
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${ap.has_cq ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>{ap.has_cq ? "CQ received" : "CQ missing"}</span>
          </div>
        ))}
      </Section>
      <Section title="In progress" hint="first contact made" count={working.length}>
        {working.map((a) => <Card key={a.id} a={a}>{manager && <TakeBackButton assignmentId={a.id} />}</Card>)}
      </Section>
    </main>
  );
}
