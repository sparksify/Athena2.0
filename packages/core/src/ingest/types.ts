/** One normalized row from a source file, ready to become a source_record. */
export interface ParsedRecord {
  sourceType: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  /** The original row, preserved verbatim for provenance. */
  raw: Record<string, unknown>;
}

/** One parser per source type, one file per parser (CLAUDE.md §3). */
export type SourceParser = (row: Record<string, unknown>) => ParsedRecord;
