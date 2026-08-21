import {
  Pressable,
  Text,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
  type ViewProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Screen shell: canvas background, safe area, the design's 20px gutter. */
export function Screen({
  children,
  className = '',
  ...rest
}: ViewProps & { className?: string }) {
  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top']}>
      <View className={`flex-1 px-5 ${className}`} {...rest}>
        {children}
      </View>
    </SafeAreaView>
  );
}

export function Card({ children, className = '', ...rest }: ViewProps & { className?: string }) {
  return (
    <View className={`rounded-card bg-card ${className}`} {...rest}>
      {children}
    </View>
  );
}

/** Uppercase tracking-wide eyebrow, e.g. "EXPECTING SOMEONE?" */
export function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <Text className={`font-jk-b text-label tracking-label ${className}`}>{children}</Text>
  );
}

/**
 * Lime = "anything that moves you forward". Reserved for the primary action on
 * a screen; a second lime button on the same screen dilutes it.
 */
export function PrimaryButton({
  title,
  className = '',
  ...rest
}: PressableProps & { title: string; className?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      className={`h-[54px] items-center justify-center rounded-full bg-lime active:opacity-80 ${className}`}
      {...rest}
    >
      <Text className="font-jk-b text-body text-ink">{title}</Text>
    </Pressable>
  );
}

export function SecondaryButton({
  title,
  className = '',
  ...rest
}: PressableProps & { title: string; className?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      className={`h-[50px] items-center justify-center rounded-card bg-card active:opacity-70 ${className}`}
      {...rest}
    >
      <Text className="font-jk-b text-sub text-ink">{title}</Text>
    </Pressable>
  );
}

/** Small lime capsule used for countdowns and "Used" tags. */
export function Chip({
  label,
  tone = 'lime',
}: {
  label: string;
  tone?: 'lime' | 'field' | 'ink';
}) {
  const bg = tone === 'lime' ? 'bg-lime' : tone === 'ink' ? 'bg-ink' : 'bg-field';
  const fg = tone === 'ink' ? 'text-canvas' : tone === 'field' ? 'text-muted' : 'text-ink';
  return (
    <View className={`h-8 justify-center rounded-full px-3.5 ${bg}`}>
      <Text className={`font-jk-b text-micro ${fg}`}>{label}</Text>
    </View>
  );
}

/** The code itself — near-black, spaced so it can be read aloud at a gate. */
export function CodeText({ code, className = '' }: { code: string; className?: string }) {
  return (
    <Text className={`font-jk-xb tracking-code text-ink ${className}`} accessibilityLabel={code.split('').join(' ')}>
      {code}
    </Text>
  );
}


/**
 * Text input, defined once so every form shares the same height and value size.
 * 44pt tall with 12.5px text was at the touch-target floor and smaller than the
 * email being typed into it.
 */
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
 * said (see lib/schemas.ts), so the rule and the sentence a resident reads can
 * never drift apart.
 *
 * `error` renders in a fixed-height slot so a field turning invalid does not
 * shove the rest of the form — and the button being reached for — down the
 * screen mid-tap.
 */
export function Field({
  error,
  label,
  className = '',
  ...rest
}: TextInputProps & {
  error?: string;
  /** Not rendered: it names the field for a screen reader, and prefixes the error. */
  label: string;
  className?: string;
  /** React 19 passes ref as a plain prop, so no forwardRef wrapper is needed. */
  ref?: React.Ref<TextInput>;
}) {
  const invalid = Boolean(error);
  return (
    <View>
      <Input
        // The message is folded into the LABEL rather than the accessibility
        // hint: VoiceOver reads hints last and can be switched off entirely, so
        // a resident using a screen reader would get a coral border they cannot
        // see and silence. The label is always read.
        accessibilityLabel={error ? `${label}. ${error}` : label}
        className={`${invalid ? 'border border-coral' : ''} ${className}`}
        {...rest}
      />
      <View className="h-5 justify-center px-1">
        {error ? <Text className="font-jk-md text-micro text-coral-ink">{error}</Text> : null}
      </View>
    </View>
  );
}

/** Whole-form failure — a rejected sign-up, a server that said no. */
export function FormError({ children }: { children: React.ReactNode }) {
  return (
    <View className="mt-1 rounded-card bg-coral-wash p-3.5">
      <Text className="font-jk-md text-sub text-coral-ink">{children}</Text>
    </View>
  );
}
