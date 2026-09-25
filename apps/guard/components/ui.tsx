import { useState } from 'react';
import {
  Pressable,
  Text,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
  type ViewProps,
} from 'react-native';

import { EyeIcon, EyeOffIcon } from './icons';

/**
 * How much room the floating nav bar needs at the bottom of a screen.
 *
 * Published here because every tab screen has to clear the same bar, and each
 * one used to carry its own guess: the keypad reserved 70px, the log and shift
 * screens 112px. 70 was exactly wrong — the bar's top edge sits at
 * BOTTOM + HEIGHT above the screen edge, so the Check key finished flush
 * against it with no gap at all, and the two numbers could not both be right.
 *
 * Derive, don't guess. Changing the bar's height or offset now moves every
 * screen with it.
 */
export const TAB_BAR_HEIGHT = 66;
export const TAB_BAR_BOTTOM = 20;
/** Deliberate breathing room, not slack. The gate is tapped in a hurry. */
export const TAB_BAR_GAP = 22;
export const TAB_BAR_CLEARANCE = TAB_BAR_HEIGHT + TAB_BAR_BOTTOM + TAB_BAR_GAP;

export function Card({ children, className = '', ...rest }: ViewProps & { className?: string }) {
  return (
    <View className={`rounded-card bg-card ${className}`} {...rest}>
      {children}
    </View>
  );
}

export function Eyebrow({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <Text className={`font-jk-xb text-label tracking-label ${className}`}>{children}</Text>;
}

export function PrimaryButton({
  title,
  className = '',
  disabled,
  ...rest
}: PressableProps & { title: string; className?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      // Announced as dimmed, and dimmed on screen. A button that is inert but
      // looks tappable reads as a broken app, and a guard with a visitor
      // waiting will tap it repeatedly rather than look for what is wrong.
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      className={`h-[54px] items-center justify-center rounded-full bg-lime active:opacity-80 ${
        disabled ? 'opacity-40' : ''
      } ${className}`}
      {...rest}
    >
      <Text className="font-jk-b text-body text-ink">{title}</Text>
    </Pressable>
  );
}

/** Dark counterpart, for a primary action sitting ON a lime screen. */
export function DarkButton({
  title,
  className = '',
  ...rest
}: PressableProps & { title: string; className?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      className={`h-[54px] items-center justify-center rounded-2xl bg-ink active:opacity-80 ${className}`}
      {...rest}
    >
      <Text className="font-jk-b text-body text-canvas">{title}</Text>
    </Pressable>
  );
}

export function OutlineButton({
  title,
  className = '',
  ...rest
}: PressableProps & { title: string; className?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      className={`h-12 items-center justify-center rounded-2xl border border-canvas/30 active:opacity-70 ${className}`}
      {...rest}
    >
      <Text className="font-jk-b text-sub text-canvas/85">{title}</Text>
    </Pressable>
  );
}

export function Input({ className = '', ...rest }: TextInputProps & { className?: string }) {
  return (
    <TextInput
      placeholderTextColor="#8b9096"
      className={`h-[52px] rounded-field bg-field px-4 font-jk text-body text-ink ${className}`}
      {...rest}
    />
  );
}

/**
 * An Input plus the one message explaining why it is not accepted yet.
 *
 * The message is passed in, never derived here — it is whatever the zod schema
 * said (see lib/schemas.ts), so the rule and the sentence a guard reads can
 * never drift apart.
 *
 * `error` is rendered in a fixed-height slot so a field appearing invalid does
 * not shove the rest of the form (and the button the guard is reaching for)
 * down the screen mid-tap.
 */
export function Field({
  error,
  label,
  className = '',
  secureTextEntry,
  ...rest
}: TextInputProps & {
  error?: string;
  label: string;
  className?: string;
  /** React 19 passes ref as a plain prop, so no forwardRef wrapper is needed. */
  ref?: React.Ref<TextInput>;
}) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = Boolean(secureTextEntry);
  const invalid = Boolean(error);

  return (
    <View>
      {/* Wraps the INPUT only. The error slot below is part of the field but
          not part of the box, and centring the eye against both would sit it
          low. */}
      <View>
        <Input
          // The message is folded into the LABEL rather than the accessibility
          // hint: VoiceOver reads hints last and can be switched off entirely,
          // so a screen-reader user would get a coral border they cannot see
          // and silence. The label is always read.
          accessibilityLabel={error ? `${label}. ${error}` : label}
          // The ONLY prop the toggle changes. autoComplete and textContentType
          // stay fixed, so the keychain keeps treating this as the same field
          // and does not re-offer to fill it on every tap.
          secureTextEntry={isPassword && !revealed}
          className={`${invalid ? 'border border-coral' : ''} ${
            isPassword ? 'pr-[52px]' : ''
          } ${className}`}
          {...rest}
        />
        {isPassword ? (
          <Pressable
            accessibilityRole="button"
            // Says what the tap DOES, not what the icon depicts. An eye alone
            // is ambiguous -- "it is shown" or "tap to show" -- and a screen
            // reader user gets no icon to disambiguate it.
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            accessibilityState={{ selected: revealed }}
            onPress={() => setRevealed((v) => !v)}
            hitSlop={8}
            // Full input height and a 52pt square: comfortably past the 44pt
            // touch-target floor, and it does not blur the input, so the
            // keyboard stays up mid-typing.
            className="absolute right-0 top-0 h-[52px] w-[52px] items-center justify-center active:opacity-60"
          >
            {revealed ? (
              <EyeOffIcon color="#8b9096" size={20} />
            ) : (
              <EyeIcon color="#8b9096" size={20} />
            )}
          </Pressable>
        ) : null}
      </View>
      <View className="h-5 justify-center px-1">
        {error ? <Text className="font-jk-md text-micro text-coral-ink">{error}</Text> : null}
      </View>
    </View>
  );
}

/**
 * Connection state, top-right of the keypad.
 *
 * Lime "Synced" vs coral "Offline" — the guard must be able to tell at a glance
 * whether the next verdict is authoritative or provisional.
 */
export function StatusDot({ online, label }: { online: boolean; label: string }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <View className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-lime' : 'bg-coral'}`} />
      <Text className={`font-jk-b text-micro ${online ? 'text-ink' : 'text-coral'}`}>{label}</Text>
    </View>
  );
}

/** Coral-washed warning strip — degraded mode, queued uploads. */
export function WarnBanner({ children }: { children: React.ReactNode }) {
  return (
    <Card className="bg-coral-wash p-3.5">
      <Text className="font-jk-md text-micro leading-[17px] text-coral-ink">{children}</Text>
    </Card>
  );
}
