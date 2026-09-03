import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Athena Voice — neural text-to-speech via ElevenLabs when configured.
 * Returns audio/mpeg for the given text; 503 when no key is set so the
 * client falls back to the browser voice. Authenticated; text only.
 */
export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "tts not configured" }, { status: 503 });

  let text: string;
  try {
    const body = (await req.json()) as { text?: unknown };
    text = typeof body.text === "string" ? body.text.trim().slice(0, 1500) : "";
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM"; // "Rachel" — clear, warm, professional
  const modelId = process.env.ELEVENLABS_MODEL_ID ?? "eleven_turbo_v2_5";

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
        }),
      },
    );
    if (!res.ok || !res.body) {
      console.error("[athena-voice] elevenlabs failed", res.status, await res.text().catch(() => ""));
      return NextResponse.json({ error: "tts failed" }, { status: 502 });
    }
    return new Response(res.body, {
      headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
    });
  } catch (err) {
    console.error("[athena-voice] elevenlabs error", err);
    return NextResponse.json({ error: "tts failed" }, { status: 502 });
  }
}
