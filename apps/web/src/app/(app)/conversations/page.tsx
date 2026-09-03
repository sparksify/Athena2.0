import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Conversations — Athena" };

const STATE_TONE: Record<string, string> = {
  open: "bg-sky-500/15 text-sky-400",
  awaiting_human: "bg-amber-500/15 text-amber-400",
  awaiting_candidate: "bg-indigo-500/15 text-indigo-300",
  closed: "bg-[#1B2333] text-[#64748B]",
};
const CLASS_TONE: Record<string, string> = {
  positive: "text-emerald-400", interested: "text-emerald-300", needs_info: "text-sky-300", asks_what_this_is: "text-sky-300",
  asks_about_brand: "text-cyan-300", asks_about_investment: "text-cyan-300", maybe_later: "text-amber-300",
  hostile: "text-red-400", unsubscribe: "text-red-400", not_interested: "text-[#8B95A7]", wrong_person: "text-[#8B95A7]",
  already_owns_franchise: "text-[#8B95A7]", already_with_consultant: "text-[#8B95A7]", ambiguous: "text-amber-400",
};

export default async function ConversationsPage() {
  const supabase = await supabaseServer();
  const [{ data: convs }, { data: classifiedEvents }, { data: overrideEvents }] = await Promise.all([
    supabase
      .from("conversation")
      .select("id, state, flagged, last_message_at, assigned_user_id, candidate(full_name, primary_email)")
      .neq("state", "closed")
      .order("flagged", { ascending: false })
      .order("last_message_at", { ascending: false })
      .limit(100),
    supabase.from("event").select("id", { count: "exact", head: true }).eq("type", "conversation.classified"),
    supabase.from("event").select("id", { count: "exact", head: true }).eq("type", "conversation.classification_overridden"),
  ]);
  // Latest inbound classification per conversation (small list; one round trip).
  const ids = (convs ?? []).map((c) => c.id);
  const { data: lastMsgs } = ids.length
    ? await supabase
        .from("message")
        .select("conversation_id, classification, classification_confidence, body_text, occurred_at")
        .in("conversation_id", ids)
        .eq("direction", "inbound")
        .order("occurred_at", { ascending: false })
    : { data: [] as { conversation_id: string; classification: string | null; classification_confidence: string | null; body_text: string | null; occurred_at: string }[] };
  const latest = new Map<string, NonNullable<typeof lastMsgs>[number]>();
  for (const m of lastMsgs ?? []) if (m.conversation_id && !latest.has(m.conversation_id)) latest.set(m.conversation_id, m);

  const classified = classifiedEvents as unknown as { count?: number } | null;
  const overridden = overrideEvents as unknown as { count?: number } | null;
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const flaggedCount = (convs ?? []).filter((c) => c.flagged).length;

  return (
    <main className="mx-auto max-w-6xl p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Conversations</h1>
          <p className="mt-1 text-sm text-[#8B95A7]">
            Flagged first. Athena answers only "who is this" and simple info questions at ≥90% confidence; everything else waits for you.
          </p>
        </div>
        <div className="flex gap-3 text-xs text-[#8B95A7]">
          <span className="rounded-lg border border-[#1E2635] bg-[#121826] px-3 py-1.5"><b className="text-amber-400">{flaggedCount}</b> flagged</span>
          <span className="rounded-lg border border-[#1E2635] bg-[#121826] px-3 py-1.5"><b className="text-[#E7ECF3]">{(convs ?? []).length}</b> open</span>
        </div>
      </div>

      <section className="mt-6 rounded-xl border border-[#1E2635] bg-[#121826]">
        <ul className="divide-y divide-[#1A2130]">
          {(convs ?? []).map((c) => {
            const cand = one(c.candidate);
            const m = latest.get(c.id);
            const conf = m?.classification_confidence == null ? null : Math.round(Number(m.classification_confidence) * 100);
            return (
              <li key={c.id}>
                <a href={`/conversations/${c.id}`} className="grid grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-3.5 hover:bg-[#161D2B]">
                  <span className={`h-2 w-2 rounded-full ${c.flagged ? "bg-amber-400 shadow-[0_0_8px_#FBBF24]" : "bg-[#2A3348]"}`} aria-label={c.flagged ? "flagged" : ""} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-[#E7ECF3]">{cand?.full_name ?? cand?.primary_email ?? "Unknown"}</span>
                      {m?.classification && (
                        <span className={`text-[11px] font-semibold ${CLASS_TONE[m.classification] ?? "text-[#8B95A7]"}`}>
                          {m.classification.replace(/_/g, " ")}{conf != null ? ` · ${conf}%` : ""}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-[#8B95A7]">{m?.body_text?.slice(0, 140) ?? "—"}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATE_TONE[c.state] ?? ""}`}>{c.state.replace("_", " ")}</span>
                    <span className="text-[11px] text-[#64748B]">{new Date(c.last_message_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                  </span>
                </a>
              </li>
            );
          })}
          {(convs ?? []).length === 0 && (
            <li className="px-5 py-6 text-sm text-[#64748B]">No open conversations. Replies land here the moment a candidate writes back.</li>
          )}
        </ul>
      </section>

      <p className="mt-4 text-[11px] text-[#64748B]" style={{ fontVariantNumeric: "tabular-nums" }}>
        Classifier: {classified?.count ?? 0} replies classified · {overridden?.count ?? 0} human overrides
        {classified?.count ? ` · ${Math.round(((overridden?.count ?? 0) / classified.count) * 100)}% override rate` : ""}
      </p>
    </main>
  );
}
