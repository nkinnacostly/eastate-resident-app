import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { qrPath } from '@/lib/qr';

/**
 * A visitor-pass QR on its own white tile.
 *
 * White, not the lime of the card it sits on: lime scans, but a scanner judges
 * dark against light by contrast, and pure white behind ink is the most a
 * phone screen at minimum brightness can offer. The quiet zone is part of the
 * drawing, so the tile needs no padding of its own to be readable.
 */
export function QrCode({ value, size }: { value: string; size: number }) {
  const { extent, d } = qrPath(value);
  // Snapped DOWN to a whole number of points per module. Every module edge
  // then falls on a whole device pixel at 1x, 2x and 3x, so neighbouring
  // modules meet cleanly instead of leaving antialiased seams between rows --
  // react-native-svg has no shape-rendering switch to turn that off.
  const side = Math.max(1, Math.floor(size / extent)) * extent;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`QR code for ${value.split('').join(' ')}`}
      style={{ width: side, height: side }}
    >
      <Svg width={side} height={side} viewBox={`0 0 ${extent} ${extent}`}>
        <Rect width={extent} height={extent} fill="#ffffff" />
        <Path d={d} fill="#16181c" />
      </Svg>
    </View>
  );
}
