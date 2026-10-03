/**
 * Table state that lives in the URL.
 *
 * Search, page, page size and sort are read from and written to the query
 * string rather than component state, so a reload, the back button and a
 * pasted link all land on the same view: `/houses/abc?q=ada&page=2&sort=-joined_at`.
 *
 * Kept here, apart from the component, for two reasons: these are pure
 * functions with real edge cases (garbage in a URL is user input) and are
 * tested directly; and exporting non-components from a component file breaks
 * React Fast Refresh for the whole file.
 *
 * Built on TanStack Table v9 (9.2.4, verified against the docs and the
 * installed types, Oct 2026). v9 makes every table declare its features up
 * front instead of v8's get*RowModel options.
 */
import {
  columnFilteringFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFns,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  type SortingState,
} from '@tanstack/react-table';

/**
 * Global filtering depends on column filtering, so that feature comes first;
 * each row model sits after the feature it belongs to (the v9 rule).
 */
export const dataTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  filterFns,
  sortFns,
});

export type DataTableFeatures = typeof dataTableFeatures;

export const PAGE_SIZES = [10, 25, 50] as const;
export const DEFAULT_PAGE_SIZE = PAGE_SIZES[0];

export interface TableParams {
  q: string;
  /** Zero-based, as TanStack counts. The URL is one-based, as people count. */
  pageIndex: number;
  pageSize: number;
  sorting: SortingState;
}

export interface TableParamsPatch {
  q?: string;
  pageIndex?: number;
  pageSize?: number;
  sorting?: SortingState;
}

/** `q`, `page`, `size`, `sort` -- or `r_q`, `r_page`... when a page holds several tables. */
const keys = (prefix: string) => ({
  q: `${prefix}q`,
  page: `${prefix}page`,
  size: `${prefix}size`,
  sort: `${prefix}sort`,
});

/**
 * Read the table's state from the URL, tolerating anything.
 *
 * Every value is user-editable, so nothing here may throw or produce a state
 * the table cannot render: a non-numeric or negative page is page 1, a size
 * outside PAGE_SIZES is the default, and a sort on a column that does not
 * exist (or cannot sort) is no sort at all.
 */
export function readTableParams(
  params: URLSearchParams,
  prefix: string,
  sortableIds: readonly string[],
): TableParams {
  const k = keys(prefix);

  const page = Number.parseInt(params.get(k.page) ?? '', 10);
  const size = Number.parseInt(params.get(k.size) ?? '', 10);

  const rawSort = params.get(k.sort) ?? '';
  const desc = rawSort.startsWith('-');
  const id = desc ? rawSort.slice(1) : rawSort;

  return {
    q: params.get(k.q) ?? '',
    pageIndex: Number.isFinite(page) && page > 1 ? page - 1 : 0,
    pageSize: (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE,
    sorting: id && sortableIds.includes(id) ? [{ id, desc }] : [],
  };
}

/**
 * Apply a change and return the next query string.
 *
 * Defaults are REMOVED rather than written (`page=1`, `size=10`, an empty
 * `q`), so the plain URL stays the canonical one and a shared link carries
 * only what the sharer actually changed. Parameters belonging to anything
 * else on the page are left alone.
 */
export function writeTableParams(
  current: URLSearchParams,
  prefix: string,
  patch: TableParamsPatch,
): URLSearchParams {
  const k = keys(prefix);
  const next = new URLSearchParams(current);
  const set = (key: string, value: string | null) =>
    value === null ? next.delete(key) : next.set(key, value);

  if (patch.q !== undefined) set(k.q, patch.q.trim() === '' ? null : patch.q);
  if (patch.pageIndex !== undefined) {
    set(k.page, patch.pageIndex > 0 ? String(patch.pageIndex + 1) : null);
  }
  if (patch.pageSize !== undefined) {
    set(k.size, patch.pageSize === DEFAULT_PAGE_SIZE ? null : String(patch.pageSize));
  }
  if (patch.sorting !== undefined) {
    const s = patch.sorting[0];
    set(k.sort, s ? `${s.desc ? '-' : ''}${s.id}` : null);
  }
  return next;
}

/**
 * The page numbers to show: always the first and last, the current one and
 * its neighbours, and `null` where a gap is elided. Seven slots at most, so
 * the control does not grow with the data.
 */
export function pageWindow(pageIndex: number, pageCount: number): (number | null)[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i);
  const out: (number | null)[] = [0];
  const start = Math.max(1, Math.min(pageIndex - 1, pageCount - 4));
  const end = Math.min(pageCount - 2, Math.max(pageIndex + 1, 3));
  // An ellipsis standing in for exactly one page hides nothing worth hiding:
  // show that page's number instead. The slot count stays the same.
  if (start > 1) out.push(start === 2 ? 1 : null);
  for (let i = start; i <= end; i++) out.push(i);
  if (end < pageCount - 2) out.push(end === pageCount - 3 ? pageCount - 2 : null);
  out.push(pageCount - 1);
  return out;
}
