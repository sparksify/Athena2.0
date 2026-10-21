"use client";

import { useRef, useState, useTransition } from "react";
import { uploadDoNotContact, type DncActionResult } from "./actions";

export function DncForm({ disabled, suppressed }: { disabled: boolean; suppressed: number }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<DncActionResult | null>(null);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      className="mt-6 rounded-xl border border-[#1E2635] bg-[#121826] p-5"
      action={(fd) => { setResult(null); start(async () => { const r = await uploadDoNotContact(fd); setResult(r); if (r.ok) ref.current?.reset(); }); }}
    >
      <h2 className="text-sm font-semibold text-[#E7ECF3]">Do-not-contact list</h2>
      <p className="mt-1 text-xs text-[#8B95A7]">
        Any CSV or plain list. Every email address and phone number in the file is suppressed the moment the upload finishes,
        and the send gate refuses it from then on. Uploading the same list twice is safe. {suppressed.toLocaleString()} identifiers are suppressed today.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs text-[#8B95A7]">File</span>
          <input type="file" name="file" accept=".csv,.txt,text/csv,text/plain" required disabled={disabled || pending}
            className="block text-sm text-[#C3CCDB] file:mr-3 file:rounded-md file:border-0 file:bg-[#1B2333] file:px-3 file:py-1.5 file:text-sm file:text-[#E7ECF3]" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-[#8B95A7]">Reason (shown on the record)</span>
          <input name="reason" placeholder="Athena 1.0 contacted list" className="rounded-md border border-[#2A3447] bg-[#0F1522] px-3 py-1.5 text-sm text-[#E7ECF3] placeholder:text-[#3D4A5C] focus:border-indigo-500 focus:outline-none" />
        </label>
        <button className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50" disabled={disabled || pending}>
          {pending ? "Suppressing…" : "Upload do-not-contact list"}
        </button>
      </div>
      {result && !result.ok && <p className="mt-3 text-sm text-red-400">{result.error}</p>}
      {result?.ok && result.summary && (
        <p className="mt-3 text-sm text-[#C3CCDB]">
          {result.summary.rows} lines · {result.summary.emails} emails and {result.summary.phones} phones found · {result.summary.added} newly suppressed · {result.summary.alreadySuppressed} were already on the list.
        </p>
      )}
    </form>
  );
}
