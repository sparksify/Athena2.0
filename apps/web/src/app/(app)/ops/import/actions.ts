"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@athena/db";
import { batchReport, drainCrmLookups, enqueueResearch, importFile, parseCsv, PARSERS, scoreCandidates } from "@athena/core";
import { GhlCrmAdapter } from "@athena/crm-ghl";
import { supabaseServer } from "@/lib/supabase/server";

const IMPORT_ROLES = new Set(["super_admin", "fcc_admin", "manager"]);
const MAX_UPLOAD_ROWS = 20_000;

export interface ImportActionResult {
  ok: boolean;
  error?: string;
  report?: Awaited<ReturnType<typeof batchReport>>;
  scored?: number;
  enriched?: number;
}

export async function runImport(formData: FormData): Promise<ImportActionResult> {
  // Role gate in the action itself: this path writes through a service
  // connection, so RLS does not protect it.
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const { data: me } = await supabase.from("user").select("role, org_id").eq("id", user.id).single();
  if (!me || !IMPORT_ROLES.has(me.role)) {
    return { ok: false, error: `Role '${me?.role ?? "none"}' may not import.` };
  }

  if (!process.env.DATABASE_URL) {
    return {
      ok: false,
      error:
        "DATABASE_URL is not configured on this deployment. Add it in Vercel → Project → Settings → Environment Variables, then redeploy.",
    };
  }

  const file = formData.get("file");
  const sourceType = String(formData.get("sourceType") ?? "");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a CSV file." };
  if (!PARSERS[sourceType]) return { ok: false, error: `Unknown source type '${sourceType}'.` };

  const rows = parseCsv(await file.text());
  if (rows.length === 0) return { ok: false, error: "No data rows found in the file." };
  if (rows.length > MAX_UPLOAD_ROWS) {
    return {
      ok: false,
      error: `${rows.length} rows — uploads are capped at ${MAX_UPLOAD_ROWS}. Use the CLI importer for the full file.`,
    };
  }

  const label = String(formData.get("label") ?? "").trim().slice(0, 200);
  const db = getDb();
  const { batchId } = await importFile(db, {
    orgId: me.org_id,
    sourceType,
    filename: file.name,
    label: label || null,
    rows,
  });

  // Small batches get enriched and scored inline so the first look at the
  // list already carries CRM history; bigger ones finish on the cron.
  let enriched = 0;
  if (rows.length <= 150 && GhlCrmAdapter.readConfigured()) {
    const r = await drainCrmLookups(db, new GhlCrmAdapter(), { orgId: me.org_id, limit: rows.length });
    enriched = r.enriched;
  }
  let scored = 0;
  if (rows.length <= 2000) {
    scored = (await scoreCandidates(db, me.org_id)).scored;
    if (process.env.ANTHROPIC_API_KEY) await enqueueResearch(db, me.org_id, { limit: 200 });
  }

  const report = await batchReport(db, me.org_id, batchId);
  revalidatePath("/ops/import");
  revalidatePath("/");
  return { ok: true, report, scored, enriched };
}
