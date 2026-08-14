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

export function Field({ children }: { children: React.ReactNode }) {
  return <View className="h-[52px] flex-row items-center rounded-field bg-field px-4">{children}</View>;
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
