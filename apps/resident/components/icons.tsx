import Svg, { Circle, Path, Rect } from 'react-native-svg';

/**
 * Icon set transcribed from the design doc: 21px, 1.9 stroke, round caps,
 * no fill. `color` is passed explicitly rather than inherited so the nav bar
 * can flip icons between lime-on-ink and muted.
 */
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

export const HomeIcon = (p: IconProps) => (
  <S {...p}>
    <Path d="M4 10.6 12 4l8 6.6V20a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />
  </S>
);

export const KeyIcon = (p: IconProps) => (
  <S {...p}>
    <Circle cx="8" cy="12" r="4.2" />
    <Path d="M12.2 12H21M17.4 12v3.4M20 12v2.4" />
  </S>
);

export const ClockIcon = (p: IconProps) => (
  <S {...p}>
    <Circle cx="12" cy="12" r="8.2" />
    <Path d="M12 7.6V12l3.2 1.9" />
  </S>
);

export const PersonIcon = (p: IconProps) => (
  <S {...p}>
    <Circle cx="12" cy="8.4" r="3.6" />
    <Path d="M5.4 20c.7-3.4 3.4-5.3 6.6-5.3s5.9 1.9 6.6 5.3" />
  </S>
);

export const WhatsAppIcon = (p: IconProps) => (
  <S {...p}>
    <Path d="M12 3.4a8.4 8.4 0 0 0-7.2 12.7L3.7 20.3l4.4-1.1A8.4 8.4 0 1 0 12 3.4Z" />
    <Path
      d="M9.1 8.6c.5 2.4 2.4 4.4 4.9 5 .8.2 1.5-.4 1.5-1.2v-.5l-1.9-.7-.8.8a5.6 5.6 0 0 1-2.3-2.3l.8-.8-.7-1.9h-.4c-.8 0-1.3.7-1.1 1.6Z"
      strokeWidth={1.4}
    />
  </S>
);

export const SmsIcon = (p: IconProps) => (
  <S {...p}>
    <Path d="M20.5 12.6c0 3.8-3.6 6.7-8 6.7-.9 0-1.7-.1-2.5-.3l-4.5 1.5 1.3-3.4A6.5 6.5 0 0 1 3.5 12c0-3.8 3.8-6.9 8.5-6.9s8.5 3.1 8.5 7.5Z" />
    <Path d="M9 12h.01M12 12h.01M15 12h.01" strokeWidth={2.2} />
  </S>
);

export const MailIcon = (p: IconProps) => (
  <S {...p}>
    <Rect x="3" y="5.5" width="18" height="13" rx="2.6" />
    <Path d="m4.4 7.4 6.3 4.6c.8.6 1.9.6 2.7 0l6.2-4.6" />
  </S>
);

export const ShareIcon = (p: IconProps) => (
  <S {...p}>
    <Path d="M21 4.4 2.9 11.2l5.2 1.9 1.7 5.6 2.9-3.3 4.2 3 4.1-14Z" />
    <Path d="m8.1 13.1 9.6-6.4-5.5 8.7" />
  </S>
);

export const CopyIcon = (p: IconProps) => (
  <S {...p}>
    <Rect x="9" y="9" width="11" height="11" rx="2.4" />
    <Path d="M5 15H4.6A1.6 1.6 0 0 1 3 13.4V4.6A1.6 1.6 0 0 1 4.6 3h8.8A1.6 1.6 0 0 1 15 4.6V5" />
  </S>
);

export const ChevronRight = (p: IconProps) => (
  <S {...p}>
    <Path d="m9 5 7 7-7 7" />
  </S>
);

export const ArrowRight = (p: IconProps) => (
  <S {...p}>
    <Path d="M4 12h15M13 6l6 6-6 6" />
  </S>
);

export const ArrowLeft = (p: IconProps) => (
  <S {...p}>
    <Path d="M20 12H5M11 6l-6 6 6 6" />
  </S>
);
