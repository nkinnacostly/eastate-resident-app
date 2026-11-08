import { create } from 'qrcode';

/**
 * The visitor-pass QR, as one SVG path.
 *
 * What it encodes is the code and nothing else -- see codeFromQr in
 * @estate/core, which is the guard's half of the same contract. Not a link: the
 * guard's phone decodes the QR on the device and checks the code against its
 * own pool when the gate has no signal, and a URL would need a network to mean
 * anything.
 *
 * Error correction H (30% of the symbol can be lost) costs nothing here: six
 * characters still fit version 1, the smallest symbol at 21x21 modules. Big
 * modules and maximum redundancy are what read off a cracked, dimmed screen
 * held up to a guard at night.
 *
 * Uses node-qrcode's `create` (qrcode 1.5.4), which only builds the matrix --
 * none of its canvas or PNG renderers are pulled in.
 */

/** The spec's minimum light border, in modules. Scanners lock on to it. */
export const QUIET_ZONE = 4;

export type QrPath = {
  /** Width and height of the whole symbol, quiet zone included, in modules. */
  extent: number;
  /** Modules per side without the quiet zone: 21 for version 1. */
  modules: number;
  /** Dark modules as an SVG path, one unit per module, quiet zone offset in. */
  d: string;
};

export function qrPath(code: string): QrPath {
  const qr = create(code, { errorCorrectionLevel: 'H' });
  const size = qr.modules.size;
  const parts: string[] = [];

  // One rectangle per horizontal run of dark modules rather than per module:
  // about a third of the path, and no hairline seams between neighbours when
  // the SVG is rasterised at a size that is not a whole multiple.
  for (let row = 0; row < size; row++) {
    let col = 0;
    while (col < size) {
      if (!qr.modules.get(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < size && qr.modules.get(row, col)) col++;
      const run = col - start;
      parts.push(`M${start + QUIET_ZONE} ${row + QUIET_ZONE}h${run}v1h-${run}z`);
    }
  }

  return { extent: size + QUIET_ZONE * 2, modules: size, d: parts.join('') };
}
