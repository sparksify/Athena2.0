"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* Athena Voice V1 — persistent "Ask Athena" control + AI operations panel.
   Browser SpeechRecognition in, browser SpeechSynthesis out, one server
   endpoint (/api/athena/ask). Typed input always works. */

type Status = "ready" | "listening" | "thinking" | "speaking" | "error";
interface MetricItem { label: string; value: string | number }
interface Turn { role: "user" | "assistant"; content: string; display?: { type: "metrics"; items: MetricItem[] } }
interface AskResponse { answer?: string; suggestions?: string[]; display?: Turn["display"]; error?: string }

/* Minimal local typing for the Web Speech API (not in lib.dom for all targets). */
interface SpeechRecognitionResultLike { isFinal: boolean; 0: { transcript: string } }
interface SpeechRecognitionEventLike { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> }
interface SpeechRecognitionLike {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const DEFAULT_SUGGESTIONS = [
  "How are we doing today?",
  "What's happening with our leads?",
  "Who are our strongest candidates?",
  "How many meetings have we booked?",
  "What needs my attention?",
];

const STATUS_LABEL: Record<Status, string> = {
  ready: "READY", listening: "LISTENING", thinking: "THINKING", speaking: "SPEAKING", error: "ERROR",
};
const STATUS_COLOR: Record<Status, string> = {
  ready: "#34D399", listening: "#22D3EE", thinking: "#A78BFA", speaking: "#818CF8", error: "#F87171",
};

export function AskAthena() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("ready");
  const [input, setInput] = useState("");
  const [interim, setInterim] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>(DEFAULT_SUGGESTIONS);
  const [muted, setMuted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [ttsSupported, setTtsSupported] = useState(true);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const neuralRef = useRef<"unknown" | "yes" | "no">("unknown"); // /api/athena/speak availability, probed once
  const busyRef = useRef(false);
  const mutedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVoiceSupported(getRecognitionCtor() !== null);
    setTtsSupported(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);
  useEffect(() => { mutedRef.current = muted; if (muted) stopSpeaking(); }, [muted]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [turns, status]);

  const stopSpeaking = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  };

  const speakBrowser = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setStatus("ready");
      return;
    }
    window.speechSynthesis.cancel(); // never overlap
    const u = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    // Preference: Edge "Natural" neural voices → macOS Premium/Enhanced → Google → Samantha → any en-US.
    const prefer = [
      /Aria.*Natural|Jenny.*Natural|Michelle.*Natural|Emma.*Natural/i,
      /Ava|Zoe|Allison|Susan|Samantha \(Enhanced\)|Premium|Enhanced/i,
      /Google US English/i,
      /Samantha/i,
    ];
    const en = voices.filter((v) => /^en[-_]US/i.test(v.lang));
    const pick = prefer.map((rx) => en.find((v) => rx.test(v.name))).find(Boolean) ?? en[0] ?? voices.find((v) => v.lang.startsWith("en"));
    if (pick) u.voice = pick;
    u.rate = 1.02;
    u.pitch = 1.0;
    u.onstart = () => setStatus("speaking");
    u.onend = () => setStatus("ready");
    u.onerror = () => setStatus("ready");
    setStatus("speaking");
    window.speechSynthesis.speak(u);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (mutedRef.current) {
        setStatus("ready");
        return;
      }
      stopSpeaking();
      // Neural voice (ElevenLabs) when the server has a key; otherwise the browser voice.
      if (neuralRef.current !== "no") {
        try {
          setStatus("speaking");
          const res = await fetch("/api/athena/speak", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text }),
          });
          if (res.status === 503) {
            neuralRef.current = "no";
          } else if (res.ok) {
            neuralRef.current = "yes";
            const url = URL.createObjectURL(await res.blob());
            const audio = new Audio(url);
            audioRef.current = audio;
            audio.onended = () => { URL.revokeObjectURL(url); if (audioRef.current === audio) { audioRef.current = null; setStatus("ready"); } };
            audio.onerror = () => { URL.revokeObjectURL(url); speakBrowser(text); };
            if (mutedRef.current) { setStatus("ready"); return; }
            await audio.play();
            return;
          }
        } catch {
          /* fall through to the browser voice */
        }
      }
      speakBrowser(text);
    },
    [speakBrowser],
  );

  const ask = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || busyRef.current) return;
      busyRef.current = true;
      stopSpeaking();
      setNotice(null);
      setInput("");
      setInterim("");
      const history = turns.slice(-8).map((t) => ({ role: t.role, content: t.content }));
      setTurns((t) => [...t, { role: "user", content: message }]);
      setStatus("thinking");
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 45_000);
        const res = await fetch("/api/athena/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message, history }),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        const json = (await res.json().catch(() => ({}))) as AskResponse;
        if (!res.ok || !json.answer) {
          const msg = res.status === 401 ? "Your session expired — sign in again." : (json.error ?? "I couldn't retrieve that information right now. Try asking again.");
          setTurns((t) => [...t, { role: "assistant", content: msg }]);
          setStatus("error");
          setTimeout(() => setStatus("ready"), 1800);
          return;
        }
        setTurns((t) => [...t, { role: "assistant", content: json.answer!, display: json.display }]);
        if (json.suggestions?.length) setSuggestions(json.suggestions);
        void speak(json.answer);
      } catch {
        setTurns((t) => [...t, { role: "assistant", content: "I couldn't reach Athena right now. Try asking again." }]);
        setStatus("error");
        setTimeout(() => setStatus("ready"), 1800);
      } finally {
        busyRef.current = false;
      }
    },
    [turns, speak],
  );

  const stopListening = () => {
    recRef.current?.stop();
    recRef.current = null;
    setStatus((s) => (s === "listening" ? "ready" : s));
  };

  const startListening = () => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setVoiceSupported(false);
      setNotice("Voice input isn't available in this browser. You can still type your question below.");
      return;
    }
    if (status === "listening") { stopListening(); return; }
    stopSpeaking();
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = "";
    rec.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r) continue;
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      setInterim(finalText || interimText);
    };
    rec.onerror = (e) => {
      recRef.current = null;
      setInterim("");
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setNotice("Microphone access was denied. You can still type your question below.");
      } else if (e.error === "no-speech") {
        setNotice("I didn't catch that — tap to talk and try again, or type below.");
      } else if (e.error !== "aborted") {
        setNotice("Voice input hit a snag. You can still type your question below.");
      }
      setStatus("ready");
    };
    rec.onend = () => {
      recRef.current = null;
      const text = finalText.trim();
      setInterim("");
      if (text) {
        setStatus("thinking");
        void ask(text);
      } else {
        setStatus((s) => (s === "listening" ? "ready" : s));
      }
    };
    recRef.current = rec;
    setNotice(null);
    setStatus("listening");
    try {
      rec.start();
    } catch {
      recRef.current = null;
      setStatus("ready");
      setNotice("Couldn't start the microphone. You can still type your question below.");
    }
  };

  const close = () => {
    stopListening();
    stopSpeaking();
    setStatus("ready");
    setOpen(false);
  };

  // Cleanup on unmount.
  useEffect(() => () => { recRef.current?.abort(); stopSpeaking(); }, []);

  const color = STATUS_COLOR[status];

  return (
    <>
      <style>{`
        @keyframes ath-pulse { 0%,100% { transform: scale(1); opacity: .55 } 50% { transform: scale(1.35); opacity: 0 } }
        @keyframes ath-spin { to { transform: rotate(360deg) } }
        @keyframes ath-breathe { 0%,100% { transform: scale(1) } 50% { transform: scale(1.04) } }
        @keyframes ath-bars { 0%,100% { transform: scaleY(.35) } 50% { transform: scaleY(1) } }
        .ath-orb-ring { animation: ath-pulse 1.4s ease-out infinite; }
        .ath-orb-ring.d2 { animation-delay: .45s }
        .ath-orb-core.thinking { animation: ath-breathe 1.6s ease-in-out infinite }
        .ath-orb-arc { animation: ath-spin 1.1s linear infinite }
        .ath-bar { transform-origin: center; animation: ath-bars .9s ease-in-out infinite }
        .ath-bar:nth-child(2) { animation-delay: .15s } .ath-bar:nth-child(3) { animation-delay: .3s }
        .ath-bar:nth-child(4) { animation-delay: .45s } .ath-bar:nth-child(5) { animation-delay: .6s }
        @keyframes ath-slide { from { transform: translateX(24px); opacity: 0 } to { transform: none; opacity: 1 } }
        .ath-panel { animation: ath-slide .18s ease-out }
      `}</style>

      {/* Persistent control */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2.5 rounded-full border border-indigo-400/40 bg-gradient-to-r from-indigo-600 to-violet-600 py-2.5 pl-3 pr-4 text-sm font-medium text-white shadow-[0_10px_30px_-10px_rgba(99,102,241,0.8)] hover:from-indigo-500 hover:to-violet-500"
        aria-label="Ask Athena"
      >
        <span className="relative flex h-5 w-5 items-center justify-center">
          <span className="absolute inset-0 rounded-full bg-cyan-300/40 blur-[3px]" />
          <span className="relative h-2.5 w-2.5 rounded-full bg-gradient-to-br from-cyan-200 to-indigo-200" />
        </span>
        Ask Athena
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={close}>
          <aside
            className="ath-panel flex h-full w-full max-w-[440px] flex-col border-l border-[#1E2635] bg-[#0D121C] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Athena AI Operations Assistant"
          >
            {/* Header */}
            <div className="flex items-start justify-between border-b border-[#1E2635] px-5 py-4">
              <div>
                <div className="bg-gradient-to-r from-sky-400 via-cyan-300 to-orange-400 bg-clip-text text-lg font-bold tracking-[0.22em] text-transparent">ATHENA</div>
                <div className="text-[11px] text-[#8B95A7]">AI Operations Assistant</div>
                <div className="mt-1.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-widest" style={{ color }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }} />
                  {STATUS_LABEL[status]}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setMuted((m) => !m)}
                  className={`rounded-md border px-2 py-1 text-[11px] ${muted ? "border-amber-500/40 text-amber-400" : "border-[#2A3447] text-[#8B95A7] hover:text-[#C3CCDB]"}`}
                  title={muted ? "Unmute Athena" : "Mute Athena"}
                >
                  {muted ? "Muted" : "Voice on"}
                </button>
                <button onClick={close} className="rounded-md border border-[#2A3447] px-2 py-1 text-[11px] text-[#8B95A7] hover:text-[#C3CCDB]" aria-label="Close">
                  ✕
                </button>
              </div>
            </div>

            {/* Orb */}
            <div className="flex flex-col items-center border-b border-[#1E2635] px-5 py-5">
              <button
                onClick={startListening}
                className="relative flex h-24 w-24 items-center justify-center rounded-full focus:outline-none"
                aria-label={status === "listening" ? "Stop listening" : "Tap to talk"}
                title={voiceSupported ? "Tap to talk" : "Voice input unavailable"}
              >
                {status === "listening" && (
                  <>
                    <span className="ath-orb-ring absolute inset-0 rounded-full border-2" style={{ borderColor: color }} />
                    <span className="ath-orb-ring d2 absolute inset-0 rounded-full border-2" style={{ borderColor: color }} />
                  </>
                )}
                {status === "thinking" && (
                  <span className="ath-orb-arc absolute inset-[-4px] rounded-full border-2 border-transparent" style={{ borderTopColor: color, borderRightColor: `${color}55` }} />
                )}
                <span
                  className={`ath-orb-core relative flex h-20 w-20 items-center justify-center rounded-full ${status}`}
                  style={{
                    background: `radial-gradient(circle at 35% 30%, ${color}cc, #4F46E5 55%, #1E1B4B 100%)`,
                    boxShadow: `0 0 34px ${color}55, inset 0 0 18px rgba(255,255,255,0.12)`,
                  }}
                >
                  {status === "speaking" ? (
                    <span className="flex h-7 items-end gap-[3px]">
                      {[0, 1, 2, 3, 4].map((i) => (
                        <span key={i} className="ath-bar block h-full w-[3px] rounded-full bg-white/90" />
                      ))}
                    </span>
                  ) : (
                    <svg viewBox="0 0 24 24" className="h-7 w-7 text-white/95" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <rect x="9" y="3" width="6" height="11" rx="3" />
                      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                    </svg>
                  )}
                </span>
              </button>
              <div className="mt-3 text-[10px] font-semibold tracking-[0.25em] text-[#8B95A7]">
                {status === "listening" ? "LISTENING…" : status === "thinking" ? "THINKING…" : status === "speaking" ? "SPEAKING" : "TAP TO TALK"}
              </div>
              {interim && <div className="mt-2 max-w-full truncate text-sm italic text-[#C3CCDB]">“{interim}”</div>}
              {notice && <div className="mt-2 text-center text-xs text-amber-300">{notice}</div>}
              {!voiceSupported && !notice && (
                <div className="mt-2 text-center text-xs text-amber-300">
                  Voice input isn&apos;t available in this browser. You can still type your question below.
                </div>
              )}
            </div>

            {/* Conversation */}
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {turns.length === 0 && (
                <p className="text-sm text-[#64748B]">
                  Ask about leads, scores, engagement, outreach, or what needs attention. Every answer comes from live Athena data.
                </p>
              )}
              {turns.map((t, i) => (
                <div key={i}>
                  <div className={`text-[10px] font-semibold tracking-wider ${t.role === "user" ? "text-[#64748B]" : "text-indigo-300"}`}>
                    {t.role === "user" ? "YOU" : "ATHENA"}
                  </div>
                  <div className={`mt-1 rounded-lg px-3 py-2 text-sm leading-relaxed ${t.role === "user" ? "bg-[#121826] text-[#C3CCDB]" : "border border-indigo-500/20 bg-indigo-500/10 text-[#E7ECF3]"}`}>
                    {t.content}
                  </div>
                  {t.display?.items?.length ? (
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {t.display.items.map((m) => (
                        <div key={m.label} className="rounded-lg border border-[#1E2635] bg-[#121826] px-2.5 py-2">
                          <div className="text-base font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{m.value}</div>
                          <div className="text-[9px] uppercase tracking-wide text-[#64748B]">{m.label}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              {status === "thinking" && <div className="text-xs text-[#64748B]">Athena is checking the data…</div>}
            </div>

            {/* Suggestions + input */}
            <div className="border-t border-[#1E2635] px-5 py-3">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => void ask(s)}
                    disabled={status === "thinking"}
                    className="rounded-full border border-[#2A3447] px-2.5 py-1 text-[11px] text-[#8B95A7] hover:border-indigo-500/50 hover:text-[#C3CCDB] disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => { e.preventDefault(); void ask(input); }}
                className="flex gap-2"
              >
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask Athena anything about your operation…"
                  className="min-w-0 flex-1 rounded-md border border-[#2A3447] bg-[#0F1522] px-3 py-2 text-sm text-[#E7ECF3] placeholder:text-[#3D4A5C] focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={status === "thinking" || !input.trim()}
                  className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  Send
                </button>
              </form>
              {!ttsSupported && <div className="mt-1.5 text-[11px] text-[#64748B]">Spoken answers aren&apos;t available in this browser; text answers still work.</div>}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
