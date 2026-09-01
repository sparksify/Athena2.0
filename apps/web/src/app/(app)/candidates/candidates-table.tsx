"use client";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import { useState } from "react";

export interface CandidateRow {
  id: string;
  full_name: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  city: string | null;
  state: string | null;
  status: string;
  current_score: number | null;
  created_at: string;
}

const col = createColumnHelper<CandidateRow>();

const columns = [
  col.accessor((r) => `${r.full_name ?? ""} ${r.primary_email ?? ""}`.trim(), {
    id: "who",
    header: "Candidate",
    cell: (info) => (
      <a className="hover:underline" href={`/candidates/${info.row.original.id}`}>
        <span className="font-medium">{info.row.original.full_name ?? "—"}</span>
        <span className="ml-2 text-zinc-500">{info.row.original.primary_email}</span>
      </a>
    ),
    filterFn: "includesString",
  }),
  col.accessor((r) => [r.city, r.state].filter(Boolean).join(", "), {
    id: "location",
    header: "Location",
    filterFn: "includesString",
  }),
  col.accessor("status", {
    header: "Status",
    filterFn: "equalsString",
    cell: (info) => (
      <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-xs">{info.getValue()}</span>
    ),
  }),
  col.accessor("current_score", {
    header: "Score",
    cell: (info) => (
      <span className="font-mono font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>
        {info.getValue() ?? "—"}
      </span>
    ),
    filterFn: (row, id, value: number) => (row.getValue<number | null>(id) ?? -1) >= value,
  }),
];

export function CandidatesTable({ rows }: { rows: CandidateRow[] }) {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [sorting, setSorting] = useState([{ id: "current_score", desc: true }]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { columnFilters, sorting },
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 50 } },
  });

  const setFilter = (id: string, value: unknown) =>
    setColumnFilters((prev) => {
      const rest = prev.filter((f) => f.id !== id);
      return value === "" || value == null ? rest : [...rest, { id, value }];
    });

  const statuses = [...new Set(rows.map((r) => r.status))].sort();

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="w-64 rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none"
          placeholder="Search name or email…"
          onChange={(e) => setFilter("who", e.target.value)}
        />
        <input
          className="w-40 rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none"
          placeholder="City or state…"
          onChange={(e) => setFilter("location", e.target.value)}
        />
        <select
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm"
          onChange={(e) => setFilter("status", e.target.value)}
          defaultValue=""
        >
          <option value="">Any status</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm"
          onChange={(e) => setFilter("current_score", e.target.value === "" ? "" : Number(e.target.value))}
          defaultValue=""
        >
          <option value="">Any score</option>
          <option value="80">Score ≥ 80</option>
          <option value="60">Score ≥ 60</option>
          <option value="40">Score ≥ 40</option>
        </select>
        <span className="ml-auto text-sm text-zinc-500" style={{ fontVariantNumeric: "tabular-nums" }}>
          {table.getFilteredRowModel().rows.length} match
        </span>
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    className="cursor-pointer px-4 py-2.5 font-medium select-none"
                    onClick={h.column.getToggleSortingHandler()}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {{ asc: " ↑", desc: " ↓" }[h.column.getIsSorted() as string] ?? ""}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-2">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-zinc-400">
                  No candidates match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center gap-2 text-sm">
        <button
          className="rounded-md border border-zinc-300 px-2.5 py-1 disabled:opacity-40"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          ‹ Prev
        </button>
        <span className="text-zinc-500" style={{ fontVariantNumeric: "tabular-nums" }}>
          Page {table.getState().pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}
        </span>
        <button
          className="rounded-md border border-zinc-300 px-2.5 py-1 disabled:opacity-40"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          Next ›
        </button>
      </div>
    </div>
  );
}
