import { describe, expect, it } from 'vitest';

import { pageWindow, readTableParams, writeTableParams } from './data-table';

const read = (qs: string, sortable = ['name', 'joined_at']) =>
  readTableParams(new URLSearchParams(qs), '', sortable);

describe('readTableParams -- the URL is user input', () => {
  it('reads a well-formed URL', () => {
    expect(read('q=ada&page=3&size=25&sort=-joined_at')).toEqual({
      q: 'ada',
      pageIndex: 2,
      pageSize: 25,
      sorting: [{ id: 'joined_at', desc: true }],
    });
  });

  it('defaults everything that is missing', () => {
    expect(read('')).toEqual({ q: '', pageIndex: 0, pageSize: 10, sorting: [] });
  });

  it('treats a nonsense, zero or negative page as page 1', () => {
    for (const p of ['abc', '0', '-4', '', '1.9x']) expect(read(`page=${p}`).pageIndex, p).toBe(0);
  });

  it('only accepts the offered page sizes', () => {
    expect(read('size=50').pageSize).toBe(50);
    for (const s of ['7', '1000', 'all', '-10']) expect(read(`size=${s}`).pageSize, s).toBe(10);
  });

  it('ignores a sort on a column that does not exist or cannot sort', () => {
    expect(read('sort=password').sorting).toEqual([]);
    expect(read('sort=-').sorting).toEqual([]);
    expect(read('sort=name').sorting).toEqual([{ id: 'name', desc: false }]);
  });

  it('reads only its own prefixed keys', () => {
    const p = new URLSearchParams('q=house&r_q=ada&r_page=2');
    expect(readTableParams(p, 'r_', []).q).toBe('ada');
    expect(readTableParams(p, 'r_', []).pageIndex).toBe(1);
  });
});

describe('writeTableParams', () => {
  const write = (qs: string, patch: Parameters<typeof writeTableParams>[2], prefix = '') =>
    writeTableParams(new URLSearchParams(qs), prefix, patch).toString();

  it('writes one-based pages and a signed sort', () => {
    expect(write('', { pageIndex: 2, sorting: [{ id: 'name', desc: true }] })).toBe('page=3&sort=-name');
  });

  it('REMOVES defaults, so the plain URL stays the canonical one', () => {
    expect(write('q=ada&page=4&size=25&sort=name', { q: '', pageIndex: 0, pageSize: 10, sorting: [] })).toBe('');
    expect(write('q=ada', { q: '   ' })).toBe('');
  });

  it('leaves everything else on the page alone', () => {
    expect(write('tab=dues&r_page=2', { pageIndex: 5 }, 'r_')).toBe('tab=dues&r_page=6');
  });
});

describe('pageWindow', () => {
  it('lists every page when there are few', () => {
    expect(pageWindow(0, 1)).toEqual([0]);
    expect(pageWindow(3, 7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('keeps first, last and the neighbours, eliding the rest', () => {
    expect(pageWindow(0, 20)).toEqual([0, 1, 2, 3, null, 19]);
    expect(pageWindow(10, 20)).toEqual([0, null, 9, 10, 11, null, 19]);
    expect(pageWindow(19, 20)).toEqual([0, null, 16, 17, 18, 19]);
  });

  it('never uses an ellipsis to hide a single page', () => {
    expect(pageWindow(3, 10)).toEqual([0, 1, 2, 3, 4, null, 9]);
    expect(pageWindow(6, 10)).toEqual([0, null, 5, 6, 7, 8, 9]);
  });

  it('never shows more than seven slots', () => {
    for (let n = 1; n <= 40; n++) {
      for (let i = 0; i < n; i++) expect(pageWindow(i, n).length).toBeLessThanOrEqual(7);
    }
  });
});
