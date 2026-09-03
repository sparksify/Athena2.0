/** Normalizes db.execute() results across drivers (postgres-js returns an array, PGlite/pg return { rows }). */
export function rows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = result as { rows?: T[] } | null;
  return r?.rows ?? [];
}
