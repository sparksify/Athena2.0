import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { answerQuestion, type HistoryTurn } from "@/lib/athena/answer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Athena Voice — the single server entry point. Authenticated via the
 * existing Supabase session; all reads go through that RLS-scoped client.
 * Read-only: no writes, no SQL from the client, no secrets returned.
 */
export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { message?: unknown; history?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 1000) : "";
  if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });
  const history: HistoryTurn[] = Array.isArray(body.history)
    ? body.history
        .filter(
          (h): h is HistoryTurn =>
            !!h && typeof h === "object" && (h as HistoryTurn).role !== undefined &&
            ((h as HistoryTurn).role === "user" || (h as HistoryTurn).role === "assistant") &&
            typeof (h as HistoryTurn).content === "string",
        )
        .slice(-10)
        .map((h) => ({ role: h.role, content: h.content.slice(0, 2000) }))
    : [];

  try {
    const result = await answerQuestion(supabase, message, history);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[athena-voice] ask failed", err);
    return NextResponse.json(
      { error: "I couldn't retrieve that information right now. Try asking again." },
      { status: 500 },
    );
  }
}
