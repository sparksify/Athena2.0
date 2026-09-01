"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@athena/db";
import { batchReport, importFile, parseCsv, PARSERS, scoreCandidates } from "@athena/core";
import { supabaseServer } from "@/lib/supabase/server";

const IMPORT_ROLES = new Set(["super_admin", "fcc_admin", "manager"]);
const MAX_UPLOAD_ROWS = 20_000;

export interface ImportActionResult {
  ok: boolean;
  error?: string;
  report?: Awaited<ReturnType<typeof batchReport>>;
  scored?: number;
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

  const db = getDb();
  const { batchId } = await importFile(db, {
    orgId: me.org_id,
    sourceType,
    filename: file.name,
    rows,
  });

  // Small batches get scored inline so the dashboard lights up immediately.
  let scored = 0;
  if (rows.length <= 2000) {
    scored = (await scoreCandidates(db, me.org_id)).scored;
  }

  const report = await batchReport(db, me.org_id, batchId);
  revalidatePath("/ops/import");
  revalidatePath("/");
  return { ok: true, report, scored };
}
