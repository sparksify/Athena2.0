"use client";

import { useState, useTransition } from "react";
import { runImport, type ImportActionResult } from "./actions";

const SOURCE_TYPES = [
  { value: "resume", label: "Resume / job board" },
  { value: "tradeshow", label: "Trade show" },
  { value: "purchased", label: "Purchased list" },
];

export function ImportForm({ disabled }: { disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportActionResult | null>(null);

  return (
    <form
      className="mt-6 rounded-xl border border-[#1E2635] bg-[#121826] p-5"
      action={(formData) => {
        setResult(null);
        startTransition(async () => setResult(await runImport(formData)));
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs text-[#8B95A7]">CSV file</span>
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            disabled={disabled || pending}
            className="block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-500"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-[#8B95A7]">Source type</span>
          <select
            name="sourceType"
            disabled={disabled || pending}
            className="rounded-md border border-[#2A3447] px-2 py-1.5 text-sm"
          >
            {SOURCE_TYPES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={disabled || pending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {pending ? "Importing…" : "Import"}
        </button>
      </div>

      {result && !result.ok && <p className="mt-3 text-sm text-red-400">{result.error}</p>}
      {result?.ok && result.report && (
        <div className="mt-4 rounded-lg border border-green-500/20 bg-green-500/5 p-4 text-sm">
          <div className="font-medium text-green-400">
            Import complete — {result.report.newCandidates} new candidate(s),{" "}
            {result.report.matchedExistingCandidates} matched, {result.report.duplicateRows}{" "}
            duplicate row(s) skipped{typeof result.scored === "number" ? `, ${result.scored} scored` : ""}.
          </div>
          <div className="mt-1 text-xs text-[#8B95A7]">
            {result.report.totalRows} rows · {result.report.newIdentifiers} new identifiers ·{" "}
            {result.report.verificationJobsQueued} verification job(s) queued ·{" "}
            {result.report.missingCriticalFields} missing contact info ·{" "}
            {result.report.rejectedRows} rejected
          </div>
          <a href="/candidates" className="mt-2 inline-block text-xs text-indigo-400 underline-offset-4 hover:underline">
            View candidates →
          </a>
        </div>
      )}
    </form>
  );
}
