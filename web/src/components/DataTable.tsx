// Generic sortable data table on top of @tanstack/react-table v8.

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useState, type KeyboardEvent, type MouseEvent } from "react";

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, any>[];
  onRowClick?: (row: T) => void;
  loading?: boolean;
  emptyMessage?: string;
  getRowId?: (row: T) => string;
  /** Controlled sorting state. When omitted the table sorts internally. */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  /**
   * When false, headers render as plain text (no sort buttons) and the given
   * row order is kept as-is. Defaults to true.
   */
  enableSorting?: boolean;
}

// Clicks that bubble from inside a link/button/… must not trigger onRowClick.
function clickTargetIsInteractive(event: MouseEvent<HTMLTableRowElement>): boolean {
  const target = event.target as HTMLElement | null;
  return target !== null && target.closest("a, button, input, select, textarea, [role='button']") !== null;
}

export default function DataTable<T>({
  data,
  columns,
  onRowClick,
  loading = false,
  emptyMessage = "No entries",
  getRowId,
  sorting: controlledSorting,
  onSortingChange,
  enableSorting = true,
}: DataTableProps<T>) {
  const [internalSorting, setInternalSorting] = useState<SortingState>([]);
  const sorting = controlledSorting ?? internalSorting;

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      if (onSortingChange) {
        onSortingChange(next);
      } else {
        setInternalSorting(next);
      }
    },
    enableSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
  });

  const rows = table.getRowModel().rows;

  if (loading) {
    return (
      <table className="data-table" aria-busy="true">
        <TableHead table={table} />
        <tbody>
          <tr>
            <td colSpan={table.getAllLeafColumns().length} className="table-message">
              Loading…
            </td>
          </tr>
        </tbody>
      </table>
    );
  }

  if (rows.length === 0) {
    return (
      <table className="data-table" aria-busy="false">
        <TableHead table={table} />
        <tbody>
          <tr>
            <td colSpan={table.getAllLeafColumns().length} className="table-message">
              {emptyMessage}
            </td>
          </tr>
        </tbody>
      </table>
    );
  }

  return (
    <table className="data-table" aria-busy="false">
      <TableHead table={table} />
      <tbody>
        {rows.map((row) => {
          const clickable = onRowClick !== undefined;
          const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
            // Only react when the row itself has focus, not a link inside it.
            if (event.target !== event.currentTarget) return;
            if (event.key === "Enter" && onRowClick) {
              onRowClick(row.original);
            }
          };
          const handleClick = (event: MouseEvent<HTMLTableRowElement>) => {
            if (clickTargetIsInteractive(event)) return;
            onRowClick?.(row.original);
          };

          return (
            <tr
              key={row.id}
              tabIndex={clickable ? 0 : undefined}
              className={clickable ? "row-clickable" : undefined}
              onClick={clickable ? handleClick : undefined}
              onKeyDown={clickable ? handleKeyDown : undefined}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

interface TableHeadProps<T> {
  table: ReturnType<typeof useReactTable<T>>;
}

function TableHead<T>({ table }: TableHeadProps<T>) {
  return (
    <thead>
      {table.getHeaderGroups().map((headerGroup) => (
        <tr key={headerGroup.id}>
          {headerGroup.headers.map((header) => {
            if (header.isPlaceholder) return null;
            const canSort = header.column.getCanSort();
            const sorted = header.column.getIsSorted();
            const sortLabel =
              sorted === "asc"
                ? "ascending"
                : sorted === "desc"
                  ? "descending"
                  : undefined;

            return (
              <th key={header.id} colSpan={header.colSpan} aria-sort={sortLabel}>
                {canSort ? (
                  <button
                    type="button"
                    className="sort-header"
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    <span className="sort-indicator" aria-hidden="true">
                      {sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : ""}
                    </span>
                  </button>
                ) : (
                  flexRender(header.column.columnDef.header, header.getContext())
                )}
              </th>
            );
          })}
        </tr>
      ))}
    </thead>
  );
}
