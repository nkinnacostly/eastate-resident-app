import { createColumnHelper } from '@tanstack/react-table';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import type { DataTableFeatures } from '../lib/data-table';
import { DataTable } from './data-table';

// Vitest does not expose `afterEach` as a global here, so Testing Library's
// automatic cleanup never registers. Without this every render piles up in
// one document and queries match the previous test's table.
afterEach(cleanup);

interface Person {
  id: string;
  name: string;
  phone: string | null;
  codes: number;
}

const col = createColumnHelper<DataTableFeatures, Person>();
const columns = col.columns([
  col.accessor('name', { header: 'Name' }),
  col.accessor('phone', { header: 'Phone', cell: (i) => i.getValue() ?? '—' }),
  col.accessor('codes', { header: 'Codes', enableGlobalFilter: false }),
]);

// 25 people: "Resident 01".."Resident 24" and, last, Ada.
const people: Person[] = [
  ...Array.from({ length: 24 }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Resident ${String(i + 1).padStart(2, '0')}`,
    phone: i % 2 ? `+2348000000${String(i).padStart(3, '0')}` : null,
    codes: i % 4,
  })),
  { id: 'ada', name: 'Ada Okafor', phone: '+2348099999999', codes: 3 },
];

/** Shows the live query string, and offers the browser's back button. */
function Probe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="search">{location.search}</output>
      <button type="button" onClick={() => navigate(-1)}>
        browser back
      </button>
    </>
  );
}

function renderAt(url: string, data: Person[] = people) {
  const ui = (d: Person[]) => (
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/houses/:id"
          element={
            <>
              <DataTable
                label="Residents"
                data={d}
                columns={columns}
                getRowId={(p) => p.id}
                emptyText="Nobody yet."
                searchPlaceholder="Search residents"
              />
              <Probe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
  const utils = render(ui(data));
  // Same tree position, so MemoryRouter keeps its history across the rerender.
  return { ...utils, rerenderWith: (d: Person[]) => utils.rerender(ui(d)) };
}

const search = () => screen.getByTestId('search').textContent;
const names = () =>
  within(screen.getByRole('table', { name: 'Residents' }))
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell')[0].textContent);

describe('DataTable', () => {
  it('opens on the first page of ten and says how many there are', () => {
    renderAt('/houses/h1');
    expect(names()).toHaveLength(10);
    expect(names()[0]).toBe('Resident 01');
    expect(screen.getByText('Showing 1–10 of 25')).toBeTruthy();
    expect(search()).toBe('');
  });

  it('opens on the page a link asks for', () => {
    renderAt('/houses/h1?page=2');
    expect(names()[0]).toBe('Resident 11');
    expect(screen.getByRole('button', { name: 'Page 2' }).getAttribute('aria-current')).toBe('page');
  });

  it('pages through the URL, and the back button walks back through pages', async () => {
    const user = userEvent.setup();
    renderAt('/houses/h1');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(search()).toBe('?page=2');
    await user.click(screen.getByRole('button', { name: 'Page 3' }));
    expect(search()).toBe('?page=3');
    expect(names()).toEqual(['Resident 21', 'Resident 22', 'Resident 23', 'Resident 24', 'Ada Okafor']);
    expect(screen.getByRole('button', { name: 'Next' })).toHaveProperty('disabled', true);

    await user.click(screen.getByRole('button', { name: 'browser back' }));
    expect(search()).toBe('?page=2');
    expect(names()[0]).toBe('Resident 11');
  });

  it('searches case-insensitively, writes q, and starts from the first page', async () => {
    const user = userEvent.setup();
    renderAt('/houses/h1?page=3');

    await user.type(screen.getByPlaceholderText('Search residents'), 'ADA');
    expect(search()).toBe('?q=ADA');
    expect(names()).toEqual(['Ada Okafor']);
    expect(screen.getByText('Showing 1–1 of 1 (filtered from 25)')).toBeTruthy();
  });

  it('searches phone numbers too, but never a column that opted out', async () => {
    const user = userEvent.setup();
    // Two rows whose digits do not overlap, so each search has one right answer.
    renderAt('/houses/h1', [
      { id: 'a', name: 'Alpha', phone: null, codes: 7 },
      { id: 'b', name: 'Bravo', phone: '+1555', codes: 0 },
    ]);
    await user.type(screen.getByPlaceholderText('Search residents'), '555');
    expect(names()).toEqual(['Bravo']);

    // 7 is only in Alpha's codes count, which is excluded from search.
    await user.clear(screen.getByPlaceholderText('Search residents'));
    await user.type(screen.getByPlaceholderText('Search residents'), '7');
    expect(screen.getByText('Nothing matches that search.')).toBeTruthy();
  });

  it('lets search keystrokes REPLACE history instead of stacking an entry per letter', async () => {
    const user = userEvent.setup();
    renderAt('/houses/h1');
    await user.click(screen.getByRole('button', { name: 'Next' })); // pushes ?page=2
    await user.type(screen.getByPlaceholderText('Search residents'), 'res'); // replaces it
    expect(search()).toBe('?q=res');

    await user.click(screen.getByRole('button', { name: 'browser back' }));
    // Straight back to where the person was before paging -- not to "?q=re".
    expect(search()).toBe('');
  });

  it('filters on first render when the link carries a search', () => {
    renderAt('/houses/h1?q=resident%200');
    expect(names()).toEqual([
      'Resident 01', 'Resident 02', 'Resident 03', 'Resident 04', 'Resident 05',
      'Resident 06', 'Resident 07', 'Resident 08', 'Resident 09',
    ]);
  });

  it('moves a page past the end to the last real page', async () => {
    renderAt('/houses/h1?page=99');
    expect(await screen.findByText('Showing 21–25 of 25')).toBeTruthy();
    expect(search()).toBe('?page=3');
  });

  // ★ The TanStack default this table turns off. With autoResetPageIndex on,
  // data arriving after the first render resets to page 1 and the deep link's
  // page is lost before anyone sees it.
  it('keeps the linked page when the data arrives after the first render', async () => {
    const { rerenderWith } = renderAt('/houses/h1?page=2', []);
    expect(screen.getByText('Nobody yet.')).toBeTruthy();

    rerenderWith(people);
    // TanStack applies its auto-reset in a LATER tick, so asserting straight
    // after the rerender passes even with the bug present (it did, until a
    // mutation test showed it). Let every pending update land first.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(names()[0]).toBe('Resident 11');
    expect(search()).toBe('?page=2');
  });

  it('takes the page size from the URL, ignores an invalid one, and writes a change', async () => {
    const user = userEvent.setup();
    renderAt('/houses/h1?size=25');
    expect(names()).toHaveLength(25);
    cleanup();

    renderAt('/houses/h1?size=7');
    expect(names()).toHaveLength(10);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Rows per page' }), '50');
    expect(search()).toBe('?size=50');
    expect(names()).toHaveLength(25);
  });

  it('sorts by a header, writes it to the URL, and reverses on a second click', async () => {
    const user = userEvent.setup();
    renderAt('/houses/h1?page=2');

    await user.click(screen.getByRole('button', { name: /name/i }));
    expect(search()).toBe('?sort=name'); // and back to page 1
    expect(names()[0]).toBe('Ada Okafor');
    expect(screen.getByRole('columnheader', { name: /name/i }).getAttribute('aria-sort')).toBe('ascending');

    await user.click(screen.getByRole('button', { name: /name/i }));
    expect(search()).toBe('?sort=-name');
    expect(names()[0]).toBe('Resident 24');
  });

  it('ignores a sort on a column that does not exist', () => {
    renderAt('/houses/h1?sort=password');
    expect(names()[0]).toBe('Resident 01');
  });

  it('tells "nothing here" apart from "nothing matches"', () => {
    renderAt('/houses/h1', []);
    expect(screen.getByText('Nobody yet.')).toBeTruthy();
    cleanup();

    renderAt('/houses/h1?q=zzzz');
    expect(screen.getByText('Nothing matches that search.')).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('leaves the rest of the query string alone', async () => {
    const user = userEvent.setup();
    renderAt('/houses/h1?tab=dues&page=2');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(search()).toBe('?tab=dues&page=3');
  });
});
