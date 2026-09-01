"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AthenaLogo } from "@/components/athena-logo";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setMessage(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setMessage(error.message);
      setBusy(false);
      return;
    }
    router.push("/consultants");
    router.refresh();
  }

  async function signUp() {
    setBusy(true);
    setMessage(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage("Account created. If email confirmation is enabled, check your inbox; otherwise sign in.");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-[#1E2635] bg-[#121826] p-8 shadow-sm">
        <AthenaLogo size={34} className="text-lg" />
        <p className="mt-2 text-sm text-[#8B95A7]">Operator sign in</p>
        <div className="mt-6 space-y-3">
          <input
            className="w-full rounded-md border border-[#2A3447] px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="w-full rounded-md border border-[#2A3447] px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && signIn()}
          />
          <button
            className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            onClick={signIn}
            disabled={busy || !email || !password}
          >
            Sign in
          </button>
          <button
            className="w-full rounded-md border border-[#2A3447] px-3 py-2 text-sm hover:bg-[#161D2B] disabled:opacity-50"
            onClick={signUp}
            disabled={busy || !email || !password}
          >
            Create account
          </button>
          {message && <p className="text-sm text-red-400">{message}</p>}
        </div>
      </div>
    </main>
  );
}
