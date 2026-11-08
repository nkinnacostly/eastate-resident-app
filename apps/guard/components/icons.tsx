import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** 21px, 1.9 stroke, round caps, no fill — same set as the resident app. */
type IconProps = { color: string; size?: number };

const S = ({ color, size = 21, children }: IconProps & { children: React.ReactNode }) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={1.9}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </Svg>
);

/** Keypad. */
export const CheckIcon = (p: IconProps) => (
  <S {...p}>
    <Rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.8" />
    <Path d="M7 9.4h.01M11 9.4h.01M15 9.4h.01M7 14.6h10" strokeWidth={2.1} />
  </S>
);

export const LogIcon = (p: IconProps) => (
  <S {...p}>
    <Path d="M5.4 4.4h13.2v15.2H5.4z" strokeWidth={1.8} />
    <Path d="M8.4 9h7.2M8.4 12.4h7.2M8.4 15.8h4.2" />
  </S>
);

export const ShiftIcon = (p: IconProps) => (
  <S {...p}>
    <Circle cx="12" cy="8.4" r="3.6" />
    <Path d="M5.4 20c.7-3.4 3.4-5.3 6.6-5.3s5.9 1.9 6.6 5.3" />
  </S>
);

export const ChevronRight = (p: IconProps) => (
  <S {...p}>
    <Path d="m9 5 7 7-7 7" />
  </S>
);

/**
 * Password reveal. Paired, so the icon states WHAT WILL HAPPEN is ambiguous --
 * an eye could mean "it is visible" or "tap to make it visible". The crossed
 * eye is shown while the password is VISIBLE, i.e. tapping it hides. That is
 * the convention iOS and every password manager uses, and the
 * accessibilityLabel says it in words for anyone the convention fails.
 */
export const EyeIcon = (p: IconProps) => (
  <S {...p}>
    <Path d="M2.6 12S6.8 5.8 12 5.8 21.4 12 21.4 12 17.2 18.2 12 18.2 2.6 12 2.6 12Z" />
    <Circle cx="12" cy="12" r="3.1" />
  </S>
);

export const EyeOffIcon = (p: IconProps) => (
  <S {...p}>
    <Path d="M10.8 6.1A9.2 9.2 0 0 1 12 6c5.2 0 9.4 6 9.4 6a16.8 16.8 0 0 1-2.9 3.4" />
    <Path d="M6.4 6.6A16.5 16.5 0 0 0 2.6 12S6.8 18 12 18a8.9 8.9 0 0 0 3.7-.8" />
    <Path d="M9.9 9.9a3.1 3.1 0 0 0 4.3 4.3" />
    <Path d="M3.6 3.6 20.4 20.4" />
  </S>
);

/** Scan a visitor's QR. Three finder squares and a scatter of modules. */
export const QrIcon = (p: IconProps) => (
  <S {...p}>
    <Rect x="3.6" y="3.6" width="6.4" height="6.4" rx="1.2" />
    <Rect x="14" y="3.6" width="6.4" height="6.4" rx="1.2" />
    <Rect x="3.6" y="14" width="6.4" height="6.4" rx="1.2" />
    <Path d="M14 14h2.6M20.4 14v.01M14 17.2v3.2M17.2 17.2h3.2v3.2M17.2 20.4h.01" />
  </S>
);

/** Torch, for a printed pass at night. A screen lights itself; paper does not. */
export const TorchIcon = (p: IconProps) => (
  <S {...p}>
    <Path d="M8 3.6h8l-1.6 4.8H9.6L8 3.6Z" />
    <Path d="M9.6 8.4v10.4a1.6 1.6 0 0 0 1.6 1.6h1.6a1.6 1.6 0 0 0 1.6-1.6V8.4" />
    <Path d="M12 12.4v2.4" />
  </S>
);
