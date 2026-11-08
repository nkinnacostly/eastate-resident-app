/**
 * The pass QR, read back by a real decoder.
 *
 * Not "the encoder was called with the right arguments" -- the SVG path the
 * screen draws is rasterised here, pixel by pixel, and handed to jsQR, an
 * independent decoder. Then what it reads goes through codeFromQr, the
 * function the guard's scanner calls. So this is the whole contract across
 * both apps: what the resident draws is what the guard's phone accepts.
 */
import { CODE_CHARSET, CODE_LENGTH, codeFromQr } from '@estate/core';
import jsQR from 'jsqr';

import { QUIET_ZONE, qrPath } from '@/lib/qr';

const PX = 4; // pixels per module

/** Paint the path the way an SVG renderer would: one rect per `M x y h n v1 h-n z`. */
function rasterise(code: string, damage?: (row: number, col: number) => boolean) {
  const { extent, d } = qrPath(code);
  const dark = Array.from({ length: extent }, () => new Array<boolean>(extent).fill(false));
  const runs = [...d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)];
  // Every byte of the path must be a run we understood -- otherwise a module
  // the screen draws could be one this test silently skipped.
  expect(runs.map((m) => m[0]).join('')).toBe(d);
  for (const [, x, y, n] of runs) {
    for (let c = Number(x); c < Number(x) + Number(n); c++) dark[Number(y)][c] = true;
  }
  if (damage) {
    for (let r = 0; r < extent; r++) {
      for (let c = 0; c < extent; c++) if (damage(r, c)) dark[r][c] = !dark[r][c];
    }
  }

  const side = extent * PX;
  const rgba = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const v = dark[Math.floor(y / PX)][Math.floor(x / PX)] ? 0x16 : 0xff;
      const i = (y * side + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
      rgba[i + 3] = 0xff;
    }
  }
  return { rgba, side, dark, extent };
}

const decode = (code: string, damage?: (row: number, col: number) => boolean) => {
  const { rgba, side } = rasterise(code, damage);
  return jsQR(rgba, side, side, { inversionAttempts: 'dontInvert' });
};

/** Deterministic, so a failure names a code that can be replayed. */
function* codes(count: number) {
  let seed = 20261108;
  for (let n = 0; n < count; n++) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      code += CODE_CHARSET[seed % CODE_CHARSET.length];
    }
    yield code;
  }
}

describe('visitor-pass QR', () => {
  it.each(['7K4P92', 'B7PJU6', 'AAAAAA', '222222', 'ZZZZZZ', '9Y8X7W'])(
    'reads back %s, and the guard accepts what it reads',
    (code) => {
      const result = decode(code);
      expect(result?.data).toBe(code);
      expect(codeFromQr(result!.data)).toBe(code);
    },
  );

  it('reads back every one of 300 generated codes', () => {
    const misread: string[] = [];
    for (const code of codes(300)) {
      const result = decode(code);
      if (result?.data !== code || codeFromQr(result.data) !== code) misread.push(code);
    }
    expect(misread).toEqual([]);
  });

  // Holds the code and nothing else -- no URL, no prefix. A link would need a
  // network to resolve; this is read on the guard's phone with or without one.
  it('encodes the bare code, not a link', () => {
    expect(decode('7K4P92')?.data).toBe('7K4P92');
    expect(decode('7K4P92')?.data).not.toMatch(/[:/]/);
  });

  it('is the smallest QR there is, with the full quiet zone around it', () => {
    const { modules, extent } = qrPath('7K4P92');
    expect(modules).toBe(21); // version 1
    expect(extent).toBe(21 + 2 * QUIET_ZONE);
    expect(decode('7K4P92')?.version).toBe(1);

    // The border really is light: nothing is drawn in it.
    const { dark } = rasterise('7K4P92');
    for (let i = 0; i < extent; i++) {
      for (const q of [0, 1, 2, 3, extent - 1, extent - 2, extent - 3, extent - 4]) {
        expect(dark[q][i]).toBe(false);
        expect(dark[i][q]).toBe(false);
      }
    }
  });

  // A cracked screen. A 5x5 block of the data area, flipped, is about four
  // codewords of damage: error correction L or M would lose the code, H (which
  // recovers eight) still reads it. This is what fails if the level slips.
  it('still reads with a 5x5 block of the symbol scratched out', () => {
    const scratch = (row: number, col: number) =>
      row >= QUIET_ZONE + 13 && row < QUIET_ZONE + 18 && col >= QUIET_ZONE + 13 && col < QUIET_ZONE + 18;
    for (const code of ['7K4P92', 'B7PJU6', 'ZZZZZZ']) {
      expect(decode(code, scratch)?.data).toBe(code);
    }
  });
});
