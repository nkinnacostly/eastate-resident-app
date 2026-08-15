import {
  Pressable,
  Text,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
  type ViewProps,
} from 'react-native';

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
