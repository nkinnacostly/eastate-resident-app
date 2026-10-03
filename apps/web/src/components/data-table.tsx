import {
  functionalUpdate,
  useTable,
  type ColumnDef,
  type PaginationState,
  type SortingState,
  type Updater,
} from '@tanstack/react-table';
import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  PAGE_SIZES,
  dataTableFeatures,
  pageWindow,
  readTableParams,
  writeTableParams,
  type DataTableFeatures,
  type TableParamsPatch,
} from '../lib/data-table';
import { Card, Empty, Search } from './ui';

/**
 * A searchable, sortable, paginated table whose state lives in the URL.
 *
 * Client-side: the rows are already in memory (a detail RPC returns them all),
 * so filtering and paging happen here. Search, page, page size and sort are
 * read from the query string on every render and written back on every change
 * -- the URL IS the state, there is no second copy to drift from it.
 *
 * Search keystrokes REPLACE the history entry; paging and sorting PUSH one. The
 * back button then steps through pages a person chose, not through every letter
 * they typed.
 */
export function DataTable<TData extends object>({
  data,
  columns,
  label,
  emptyText,
  noMatchText = 'Nothing matches that search.',
  searchPlaceholder = 'Search',
  prefix = '',
  getRowId,
}: {
  data: TData[];
  /**
   * Must be referentially stable -- define it outside the component. `any`
   * for the value type because each column holds a different one, which is
   * how TanStack's own examples type a mixed column list.
   */
  columns: ColumnDef<DataTableFeatures, TData, any>[];
  /** Accessible name for the table element. */
  label: string;
  /** Shown when there are no rows at all, as opposed to none matching. */
  emptyText: string;
  noMatchText?: string;
  searchPlaceholder?: string;
  /** Namespaces the URL keys when a page holds more than one table. */
  prefix?: string;
  getRowId?: (row: TData) => string;
}) {
  const [params, setParams] = useSearchParams();

  const sortableIds = useMemo(
    () =>
      columns.flatMap((c) => {
        const id =
          c.id ?? ('accessorKey' in c && typeof c.accessorKey === 'string' ? c.accessorKey : undefined);
        return id && c.enableSorting !== false ? [id] : [];
      }),
    [columns],
  );

  const { q, pageIndex, pageSize, sorting } = readTableParams(params, prefix, sortableIds);
  const pagination: PaginationState = { pageIndex, pageSize };

  const update = useCallback(
    (patch: TableParamsPatch, replace: boolean) =>
      setParams((prev) => writeTableParams(prev, prefix, patch), { replace }),
    [setParams, prefix],
  );

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    state: { globalFilter: q, pagination, sorting },
    onGlobalFilterChange: (u: Updater<unknown>) =>
      // A new search always starts from the first page of its results.
      update({ q: String(functionalUpdate(u, q) ?? ''), pageIndex: 0 }, true),
    onPaginationChange: (u: Updater<PaginationState>) => {
      const next = functionalUpdate(u, pagination);
      update({ pageIndex: next.pageIndex, pageSize: next.pageSize }, false);
    },
    onSortingChange: (u: Updater<SortingState>) =>
      update({ sorting: functionalUpdate(u, sorting), pageIndex: 0 }, false),
    // OFF, deliberately. By default the page index resets to 0 whenever the row
    // models recompute -- including when the data first arrives -- which would
    // throw away the `page` a deep link asked for before it was ever shown.
    autoResetPageIndex: false,
    // One sort at a time: the URL holds one `sort`, and shift-click multi-sort
    // is a feature nobody would discover here.
    enableMultiSort: false,
    globalFilterFn: 'includesString',
  });

  const rowCount = table.getPrePaginatedRowModel().rows.length;
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));

  // A page past the end -- a stale link, or a list that shrank -- moves to the
  // last real page rather than showing an empty table under a valid search.
  // Only once there is data: before it arrives every page looks out of range.
  useEffect(() => {
    if (data.length > 0 && pageIndex > pageCount - 1) update({ pageIndex: pageCount - 1 }, true);
  }, [data.length, pageIndex, pageCount, update]);

  const rows = table.getRowModel().rows;
  const first = rowCount === 0 ? 0 : pageIndex * pageSize + 1;
  const last = Math.min(rowCount, (pageIndex + 1) * pageSize);

  const pageButton = 'h-8 min-w-8 rounded-chip px-2.5 text-[12px] font-bold transition disabled:opacity-40';

  return (
    <div>
      <div className="flex items-center gap-2">
        <Search value={q} onChange={(v) => table.setGlobalFilter(v)} placeholder={searchPlaceholder} />
      </div>

      <Card className="mt-3.5 overflow-x-auto py-2">
        <table className="w-full border-collapse text-left" aria-label={label}>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                      className="whitespace-nowrap px-4 pb-2.5 pt-2 text-[10.5px] font-extrabold uppercase tracking-label text-muted"
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 uppercase transition hover:text-ink"
                        >
                          <table.FlexRender header={header} />
                          <span aria-hidden="true" className="w-2">
                            {sorted === 'asc' ? '↑' : sorted === 'desc' ? '↓' : ''}
                          </span>
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-hair">
                {/* getAllCells, not getVisibleCells: in v9 the latter belongs to
                    columnVisibilityFeature, which this table does not register. */}
                {row.getAllCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3 align-middle text-[12.5px]">
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <Empty>{data.length === 0 ? emptyText : noMatchText}</Empty> : null}
      </Card>

      {rowCount > 0 ? (
        <nav
          aria-label={`${label} pages`}
          className="mt-3.5 flex flex-wrap items-center justify-between gap-3 text-[12px] font-semibold text-muted"
        >
          <span>
            Showing {first}–{last} of {rowCount}
            {rowCount < data.length ? ` (filtered from ${data.length})` : ''}
          </span>

          <div className="flex items-center gap-1.5">
            <label className="mr-2 flex items-center gap-2">
              Rows per page
              <select
                value={pageSize}
                onChange={(e) => table.setPageSize(Number(e.target.value))}
                className="h-8 rounded-chip bg-field px-2 font-bold text-ink outline-none focus:ring-2 focus:ring-lime"
              >
                {PAGE_SIZES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className={`${pageButton} bg-field text-ink hover:brightness-95`}
            >
              Previous
            </button>
            {pageWindow(pageIndex, pageCount).map((p, i) =>
              p === null ? (
                <span key={`gap-${i}`} aria-hidden="true" className="px-1">…</span>
              ) : (
                <button
                  key={p}
                  type="button"
                  onClick={() => table.setPageIndex(p)}
                  aria-current={p === pageIndex ? 'page' : undefined}
                  aria-label={`Page ${p + 1}`}
                  className={`${pageButton} ${p === pageIndex ? 'bg-ink text-canvas' : 'bg-field text-ink hover:brightness-95'}`}
                >
                  {p + 1}
                </button>
              ),
            )}
            <button
              type="button"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className={`${pageButton} bg-field text-ink hover:brightness-95`}
            >
              Next
            </button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
