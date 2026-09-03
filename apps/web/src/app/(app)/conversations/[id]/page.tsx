import { notFound } from "next/navigation";
import { ALL_CLASSIFICATIONS } from "@athena/core";
import { supabaseServer } from "@/lib/supabase/server";
import { OverrideSelect, ReplyForm, ThreadControls } from "../controls";

export const dynamic = "force-dynamic";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: conv } = await supabase
    .from("conversation")
    .select("id, state, flagged, last_message_at, candidate_id, assigned_user_id, candidate(id, full_name, primary_email, city, state, current_score)")
    .eq("id", id)
    .single();
  if (!conv) notFound();
  const cand = Array.isArray(conv.candidate) ? conv.candidate[0] : conv.candidate;

  const [{ data: msgs }, { data: facts }] = await Promise.all([
    supabase.from("message").select("id, direction, subject, body_text, occurred_at, classification, classification_confidence").eq("conversation_id", id).order("occurred_at", { ascending: true }),
    supabase.from("candidate_attribute").select("key, value").eq("candidate_id", conv.candidate_id).is("superseded_by_id", null),
  ]);
  const researchNote = (facts ?? []).find((f) => f.key === "research_note");
  const lastInbound = [...(msgs ?? [])].reverse().find((m) => m.direction === "inbound");
  const defaultSubject = lastInbound?.subject ? (lastInbound.subject.startsWith("Re:") ? lastInbound.subject : `Re: ${lastInbound.subject}`) : "Re: your note";

  return (
    <main className="mx-auto max-w-6xl p-8">
      <a href="/conversations" className="text-sm text-indigo-400 hover:underline">← Conversations</a>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{cand?.full_name ?? "Unknown"}</h1>
          <p className="text-sm text-[#8B95A7]">
            {cand?.primary_email} · {[cand?.city, cand?.state].filter(Boolean).join(", ") || "—"} · score {cand?.current_score ?? "—"} ·{" "}
            <a href={`/candidates/${conv.candidate_id}`} className="text-indigo-400 hover:underline">open 360</a>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${conv.flagged ? "bg-amber-500/15 text-amber-400" : "bg-[#1B2333] text-[#8B95A7]"}`}>{conv.state.replace("_", " ")}{conv.flagged ? " · flagged" : ""}</span>
          <ThreadControls conversationId={conv.id} state={conv.state} />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[2fr_1fr]">
        <section className="space-y-3">
          {(msgs ?? []).map((m) => (
            <article key={m.id} className={`rounded-xl border p-4 ${m.direction === "inbound" ? "border-indigo-500/20 bg-indigo-500/5" : "border-[#1E2635] bg-[#121826]"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#64748B]">
                <span><b className={m.direction === "inbound" ? "text-indigo-300" : "text-[#C3CCDB]"}>{m.direction === "inbound" ? "Candidate" : "Athena / team"}</b> · {new Date(m.occurred_at).toLocaleString()}</span>
                {m.direction === "inbound" && (
                  <span className="flex items-center gap-2">
                    {m.classification_confidence != null && <span style={{ fontVariantNumeric: "tabular-nums" }}>{Math.round(Number(m.classification_confidence) * 100)}% confidence</span>}
                    <OverrideSelect messageId={m.id} current={m.classification} classes={ALL_CLASSIFICATIONS} />
                  </span>
                )}
              </div>
              <div className="mt-2 text-sm font-medium text-[#E7ECF3]">{m.subject}</div>
              <pre className="mt-1.5 whitespace-pre-wrap font-sans text-sm leading-relaxed text-[#C3CCDB]">{m.body_text}</pre>
            </article>
          ))}
          {conv.state !== "closed" && (
            <section className="rounded-xl border border-[#1E2635] bg-[#121826] p-4">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">Reply</h2>
              <div className="mt-3"><ReplyForm conversationId={conv.id} defaultSubject={defaultSubject} /></div>
            </section>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-[#1E2635] bg-[#121826] p-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">What we know (with provenance)</h2>
            <ul className="mt-2 space-y-1.5 text-sm">
              {(facts ?? []).filter((f) => f.key !== "research_note").map((f) => (
                <li key={f.key} className="flex justify-between gap-3"><span className="text-[#8B95A7]">{f.key.replace(/_/g, " ")}</span><span className="truncate text-[#E7ECF3]">{typeof f.value === "string" ? f.value : JSON.stringify(f.value)}</span></li>
              ))}
              {(facts ?? []).filter((f) => f.key !== "research_note").length === 0 && <li className="text-[#64748B]">No attributes on record yet.</li>}
            </ul>
          </section>
          <section className="rounded-xl border border-[#1E2635] bg-[#121826] p-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">Research note</h2>
            <p className="mt-2 text-sm text-[#C3CCDB]">{researchNote ? String(researchNote.value) : <span className="text-[#64748B]">None yet — research agents arrive with Phase 8.</span>}</p>
          </section>
          <section className="rounded-xl border border-[#1E2635] bg-[#121826] p-4 text-[11px] text-[#64748B]">
            Athena sees only these facts plus the last six messages when it classifies or replies — never the raw history.
          </section>
        </aside>
      </div>
    </main>
  );
}
