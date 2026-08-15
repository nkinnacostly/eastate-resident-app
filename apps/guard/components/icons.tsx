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
