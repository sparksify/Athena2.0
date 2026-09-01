import { supabaseServer } from "@/lib/supabase/server";
import { ImportForm } from "./import-form";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function ImportPage() {
  const supabase = await supabaseServer();
  const dbConfigured = Boolean(process.env.DATABASE_URL);

  const { data: batches } = await supabase
    .from("import_batch")
    .select("id, filename, source_type, status, report, started_at, finished_at")
    .order("started_at", { ascending: false })
    .limit(25);

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Import</h1>
      <p className="mt-1 text-sm text-[#8B95A7]">
        Upload a CSV of historical records. Rows are preserved verbatim, normalized, deduplicated
        by content, and matched to candidates deterministically (exact email/phone only) — then
        scored. Re-uploading the same file is always safe.
      </p>

      {!dbConfigured && (
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          <strong>One-time setup needed:</strong> this deployment has no <code>DATABASE_URL</code>.
          In Vercel → Project <em>athena2-0</em> → Settings → Environment Variables, add
          <code className="mx-1">DATABASE_URL</code> with the Supabase transaction-pooler
          connection string (Supabase dashboard → Connect → Transaction pooler, password filled
          in), then redeploy. Until then, uploads are disabled.
        </div>
      )}

      <ImportForm disabled={!dbConfigured} />

      <section className="mt-10">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8B95A7]">
          Import history
        </h2>
        <div className="mt-2 space-y-2">
          {(batches ?? []).map((b) => {
            const r = (b.report ?? {}) as Record<string, number>;
            return (
              <details key={b.id} className="rounded-lg border border-[#1E2635] bg-[#121826]">
                <summary className="flex cursor-pointer items-center justify-between px-4 py-2.5 text-sm">
                  <span>
                    <span className="font-medium">{b.filename}</span>
                    <span className="ml-2 font-mono text-xs text-[#64748B]">{b.source_type}</span>
                  </span>
                  <span className="flex items-center gap-3 text-xs text-[#8B95A7]">
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>
                      {r.totalRows ?? "—"} rows · {r.newCandidates ?? 0} new · {r.duplicateRows ?? 0} dup
                    </span>
                    <span className={b.status === "completed" ? "text-green-400" : b.status === "failed" ? "text-red-400" : "text-amber-400"}>
                      {b.status}
                    </span>
                    <span className="text-[#3D4A5C]">{new Date(b.started_at).toLocaleString()}</span>
                  </span>
                </summary>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 border-t border-[#1A2130] px-4 py-3 text-xs sm:grid-cols-3">
                  {Object.entries(r)
                    .filter(([k, v]) => typeof v === "number" && k !== "processingMs")
                    .map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <span className="text-[#8B95A7]">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                        <span className="font-mono" style={{ fontVariantNumeric: "tabular-nums" }}>{v}</span>
                      </div>
                    ))}
                  {typeof r.processingMs === "number" && (
                    <div className="flex justify-between">
                      <span className="text-[#8B95A7]">processing</span>
                      <span className="font-mono">{(r.processingMs / 1000).toFixed(1)}s</span>
                    </div>
                  )}
                </div>
              </details>
            );
          })}
          {(batches ?? []).length === 0 && (
            <p className="py-3 text-sm text-[#64748B]">No imports yet.</p>
          )}
        </div>
      </section>
    </main>
  );
}
