import { CODE_CHARSET, CODE_LENGTH } from '@estate/core';
import * as Haptics from 'expo-haptics';
import { Pressable, Text, View } from 'react-native';

/**
 * The keypad shows EXACTLY the glyphs a code can contain.
 *
 * This is a correctness feature, not styling. The charset excludes 0/O and
 * 1/I/L precisely because they are misread aloud at a gate — offering a full
 * QWERTY keyboard would hand those ambiguous glyphs straight back and generate
 * unknown-code rejections for codes that are actually fine. There is no free
 * text entry anywhere in this app.
 *
 * Letters and digits are split visually (digits carry a tint) so a guard
 * transcribing a code read out over a phone can find the right key fast.
 */
const LETTERS = CODE_CHARSET.split('').filter((c) => /[A-Z]/.test(c));
const DIGITS = CODE_CHARSET.split('').filter((c) => /[0-9]/.test(c));

export function CodeBoxes({ value }: { value: string }) {
  return (
    <View className="flex-row gap-1.5">
      {Array.from({ length: CODE_LENGTH }).map((_, i) => {
        const char = value[i];
        const isCaret = i === value.length;
        return (
          <View
            key={i}
            accessibilityLabel={char ? `Position ${i + 1}: ${char}` : `Position ${i + 1}: empty`}
            className={`h-14 flex-1 items-center justify-center rounded-card bg-card ${
              isCaret ? 'border-2 border-lime' : ''
            }`}
          >
            {char ? (
              <Text className="font-jk-xb text-[22px] text-ink">{char}</Text>
            ) : isCaret ? (
              <View className="h-5 w-0.5 bg-ink" />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function Key({
  label,
  onPress,
  disabled,
  className = '',
  textClassName = '',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  className?: string;
  textClassName?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        // Confirms the tap without the guard looking down — they are watching
        // the visitor, not the phone.
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      className={`h-10 items-center justify-center rounded-xl active:opacity-60 ${
        disabled ? 'opacity-40' : ''
      } ${className}`}
    >
      <Text className={`font-jk-b text-[16px] text-ink ${textClassName}`}>{label}</Text>
    </Pressable>
  );
}

export function Keypad({
  value,
  onChange,
  onSubmit,
  onBlur,
  busy,
  canSubmit,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  /** Marks the field touched once the guard has entered anything. */
  onBlur?: () => void;
  busy?: boolean;
  /**
   * Whether the schema accepts what is typed. Passed in rather than recomputed
   * here — the keypad must not hold a second opinion about what a valid code
   * is, or the two will drift.
   */
  canSubmit: boolean;
}) {
  const full = value.length === CODE_LENGTH;
  const press = (c: string) => {
    if (value.length < CODE_LENGTH) onChange(value + c);
    onBlur?.();
  };

  return (
    <View className="gap-1.5">
      <View className="flex-row flex-wrap gap-1.5">
        {LETTERS.map((c) => (
          <Key
            key={c}
            label={c}
            onPress={() => press(c)}
            disabled={full}
            className="w-[15.4%] bg-card"
          />
        ))}
        {DIGITS.map((c) => (
          <Key
            key={c}
            label={c}
            onPress={() => press(c)}
            disabled={full}
            className="w-[15.4%] bg-digit"
          />
        ))}
      </View>

      <View className="flex-row gap-1.5">
        <Key
          label="Delete"
          onPress={() => {
            onChange(value.slice(0, -1));
            onBlur?.();
          }}
          disabled={value.length === 0}
          className="flex-1 bg-field"
          textClassName="text-sub text-muted"
        />
        <Key
          label={busy ? 'Checking…' : 'Check'}
          onPress={onSubmit}
          // Guarded on the SCHEMA, not on length: a code that is short, or the
          // right length but carrying a glyph no code can contain, can only
          // ever come back unknown_code — and that writes a junk row into the
          // audit log an admin then has to read.
          disabled={!canSubmit || busy}
          className="flex-1 bg-lime"
          textClassName="text-sub"
        />
      </View>
    </View>
  );
}
