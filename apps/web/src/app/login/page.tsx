"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AthenaLogo } from "@/components/athena-logo";

/* Login redesigned 2026-09-02 to Steve's split-screen mockup: brand panel
   with the pipeline story on the left, operator sign-in card on the right.
   Accounts are provisioned by an administrator; self-serve sign-up is not
   offered here. */

function Icon({ size = 18, stroke = 1.8, children }: { size?: number; stroke?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const STEPS = [
  { label: "Ingest", color: "#A78BFA", icon: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></> },
  { label: "Engage", color: "#60A5FA", icon: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M8 10h.01M12 10h.01M16 10h.01" /></> },
  { label: "Qualify", color: "#2DD4BF", icon: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></> },
  { label: "Route", color: "#FBBF24", icon: <><path d="M16 3h5v5" /><path d="M21 3 13 11" /><path d="M3 12h4a4 4 0 0 1 4 4v5" /><path d="M3 12h4a4 4 0 0 0 4-4V3" /><path d="M16 21h5v-5" /><path d="m21 21-4-4" /></> },
];

const TRUST = [
  { label: "Deterministic routing", color: "#A78BFA", icon: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></> },
  { label: "Auditable actions", color: "#60A5FA", icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h6" /></> },
  { label: "Human oversight", color: "#2DD4BF", icon: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></> },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "error" | "info" } | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setMessage(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setMessage({ text: error.message, tone: "error" });
      setBusy(false);
      return;
    }
    router.push("/consultants");
    router.refresh();
  }

  async function forgotPassword() {
    if (!email) {
      setMessage({ text: "Enter your email address first and we'll send a reset link.", tone: "info" });
      return;
    }
    setBusy(true);
    setMessage(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setBusy(false);
    setMessage(
      error
        ? { text: error.message, tone: "error" }
        : { text: "If that address has an account, a password reset link is on its way.", tone: "info" },
    );
  }

  const field =
    "w-full rounded-xl border border-white/[0.08] bg-[#0F1522]/80 px-4 py-3.5 text-[15px] text-[#E7ECF3] placeholder:text-[#64748B] focus:border-indigo-400/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/25";

  return (
    <main className="grid min-h-screen bg-[#0A0D16] text-[#E7ECF3] lg:grid-cols-[1.1fr_1fr]">
      {/* brand panel */}
      <section
        className="relative hidden overflow-hidden border-r border-white/[0.06] px-12 py-10 lg:flex lg:flex-col"
        style={{
          background:
            "radial-gradient(900px 500px at 15% 0%, rgba(99,102,241,0.14), transparent 60%), radial-gradient(700px 420px at 55% 65%, rgba(34,211,238,0.08), transparent 60%), linear-gradient(180deg, #0B1020 0%, #0A0D16 100%)",
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{ backgroundImage: "radial-gradient(rgba(148,163,184,0.18) 1px, transparent 1px)", backgroundSize: "26px 26px" }}
          aria-hidden
        />
        <div className="relative">
          <AthenaLogo size={44} className="text-2xl" />
        </div>

        <div className="relative mt-16 max-w-xl">
          <h1 className="text-[52px] font-semibold leading-[1.08] tracking-tight text-white">
            Turn dormant leads
            <br />
            into live opportunities.
          </h1>
          <p className="mt-6 max-w-md text-[19px] leading-relaxed text-[#94A0B8]">
            Athena coordinates outreach, qualification, routing, and consultant follow-up from one
            intelligent command center.
          </p>
        </div>

        {/* pipeline story */}
        <div className="relative mt-14 max-w-2xl">
          <svg viewBox="0 0 720 200" className="absolute inset-x-0 top-1/2 h-[200px] w-full -translate-y-1/2" aria-hidden>
            <defs>
              <linearGradient id="flow" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#A78BFA" />
                <stop offset="38%" stopColor="#60A5FA" />
                <stop offset="68%" stopColor="#2DD4BF" />
                <stop offset="100%" stopColor="#FBBF24" />
              </linearGradient>
            </defs>
            <path d="M40 100 C 120 40, 200 160, 280 100 S 440 40, 520 100 S 640 160, 700 100" fill="none" stroke="url(#flow)" strokeWidth={1.2} opacity={0.35} />
            <path d="M40 100 C 120 160, 200 40, 280 100 S 440 160, 520 100 S 640 40, 700 100" fill="none" stroke="url(#flow)" strokeWidth={1.2} opacity={0.22} />
            <path d="M20 100 H 700" stroke="url(#flow)" strokeWidth={2} opacity={0.55} />
            {[90, 210, 330, 450, 570, 650].map((x, i) => (
              <circle key={x} cx={x} cy={i % 2 ? 62 : 138} r={2.5} fill="url(#flow)" opacity={0.7} />
            ))}
          </svg>
          <div className="relative grid grid-cols-4 gap-4">
            {STEPS.map((s) => (
              <div key={s.label} className="flex flex-col items-center">
                <span
                  className="flex h-[88px] w-[88px] items-center justify-center rounded-full border-2 bg-[#0B1020]"
                  style={{ borderColor: s.color, color: s.color, boxShadow: `0 0 28px ${s.color}33, inset 0 0 22px ${s.color}14` }}
                >
                  <Icon size={30} stroke={1.7}>{s.icon}</Icon>
                </span>
                <span className="mt-4 text-[17px] font-medium text-[#E7ECF3]">{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* trust chips */}
        <div className="relative mt-auto flex flex-wrap gap-8 pt-14">
          {TRUST.map((t) => (
            <div key={t.label} className="flex items-center gap-4">
              <span
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border bg-[#0B1020]"
                style={{ borderColor: `${t.color}80`, color: t.color }}
              >
                <Icon size={24} stroke={1.6}>{t.icon}</Icon>
              </span>
              <span className="max-w-[120px] text-[17px] leading-snug text-[#E7ECF3]">{t.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* sign-in panel */}
      <section
        className="relative flex flex-col items-center justify-center px-6 py-12"
        style={{ background: "radial-gradient(800px 500px at 50% 40%, rgba(99,102,241,0.10), transparent 60%)" }}
      >
        <div className="mb-8 lg:hidden">
          <AthenaLogo size={36} className="text-xl" />
        </div>
        <div className="w-full max-w-[520px] rounded-3xl border border-white/[0.08] bg-gradient-to-b from-[#151B2E] to-[#101625] p-10 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]">
          <div className="text-center">
            <div className="text-[13px] font-bold uppercase tracking-[0.28em]">
              <span className="text-sky-400">Athena </span>
              <span className="text-amber-300">Command</span>
            </div>
            <h2 className="mt-4 text-[40px] font-semibold tracking-tight text-white">Welcome back</h2>
            <p className="mt-2 text-[17px] text-[#94A0B8]">Sign in to continue to your command center.</p>
          </div>

          <form
            className="mt-9 space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy && email && password) void signIn();
            }}
          >
            <label className="block">
              <span className="mb-2 block text-[15px] text-[#E7ECF3]">Email address</span>
              <input
                className={field}
                type="email"
                autoComplete="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-[15px] text-[#E7ECF3]">Password</span>
              <span className="relative block">
                <input
                  className={`${field} pr-12`}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-[#94A0B8] hover:text-[#E7ECF3]"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <Icon size={20}>
                    {showPassword ? (
                      <>
                        <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24M1 1l22 22" />
                      </>
                    ) : (
                      <>
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </>
                    )}
                  </Icon>
                </button>
              </span>
            </label>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={forgotPassword}
                disabled={busy}
                className="text-[15px] text-indigo-300 hover:underline disabled:opacity-50"
              >
                Forgot password?
              </button>
            </div>
            <button
              type="submit"
              disabled={busy || !email || !password}
              className="w-full rounded-xl bg-gradient-to-b from-[#7C6CF6] to-[#5B4CE6] py-4 text-[19px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_10px_30px_-10px_rgba(99,102,241,0.7)] hover:from-[#8778F8] hover:to-[#6555EA] disabled:opacity-50"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
            {message && (
              <p className={`text-center text-sm ${message.tone === "error" ? "text-red-400" : "text-[#94A0B8]"}`}>
                {message.text}
              </p>
            )}
          </form>

          <div className="mt-5 flex items-center justify-center gap-2 text-[15px] text-[#94A0B8]">
            <Icon size={16}>
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </Icon>
            Secure operator access
          </div>

          <p className="mt-6 border-t border-white/[0.08] pt-6 text-center text-[15px] text-[#94A0B8]">
            Need access? <span className="text-indigo-300">Contact your Athena administrator.</span>
          </p>
        </div>

        <div className="mt-8 flex items-center gap-4 text-[15px] text-[#94A0B8]">
          <span>Privacy</span>
          <span className="h-1 w-1 rounded-full bg-indigo-400" />
          <span>Security</span>
          <span className="h-1 w-1 rounded-full bg-indigo-400" />
          <span>Support</span>
        </div>
      </section>
    </main>
  );
}
