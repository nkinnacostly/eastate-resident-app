import { zodResolver } from '@hookform/resolvers/zod';
import { MAX_DELIVERY_NOTE_LENGTH } from '@estate/core';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DeliveryDetails } from '@/lib/api';
import { deliveryNoteSchema, type DeliveryNoteValues } from '@/lib/schemas';

/**
 * The two-step question asked before a code is minted.
 *
 * Step one is a plain yes/no because most codes are not deliveries and that
 * path has to stay one tap from where it was. Only "yes" costs the resident a
 * second screen.
 *
 * `import type` above is deliberate: DeliveryDetails is erased at compile time,
 * so this component never pulls the Supabase client into a render test.
 */
type Step = 'ask' | 'note';

export function DeliveryPrompt({
  visible,
  busy = false,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (delivery: DeliveryDetails) => void;
}) {
  const [step, setStep] = useState<Step>('ask');
  const insets = useSafeAreaInsets();

  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<DeliveryNoteValues>({
    resolver: zodResolver(deliveryNoteSchema),
    mode: 'onChange',
    defaultValues: { note: '' },
  });

  // Reset on every open. Without this the resident who cancelled halfway
  // through a delivery reopens the prompt already on the note step, holding
  // text they typed for a code that was never minted.
  useEffect(() => {
    if (visible) {
      setStep('ask');
      reset({ note: '' });
    }
  }, [visible, reset]);

  const note = watch('note');
  const remaining = MAX_DELIVERY_NOTE_LENGTH - note.length;

  const submitNote = handleSubmit((values) => onSubmit({ isDelivery: true, note: values.note }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // Android's hardware back button. Without this the prompt is inescapable
      // there, because the backdrop is the only other way out.
      onRequestClose={busy ? undefined : onCancel}
      accessibilityViewIsModal
    >
      <View className="flex-1 justify-end">
        {/* Backdrop. Not pressable while minting: dismissing mid-request would
            leave a code minted with nowhere to navigate. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          disabled={busy}
          onPress={onCancel}
          className="absolute inset-0 bg-ink/50"
        />

        {step === 'ask' ? (
          <View className="flex-1 items-center justify-center px-6">
            <Animated.View
              entering={FadeIn.duration(140)}
              exiting={FadeOut.duration(100)}
              className="w-full rounded-card bg-card p-6"
            >
              <Text className="font-jk-xb text-[21px] leading-7 tracking-tight text-ink">
                Is this code for a delivery?
              </Text>
              <Text className="mt-2 font-jk text-sub text-muted">
                Riders get instructions with the code, so they do not have to phone you from
                the gate.
              </Text>

              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => setStep('note')}
                className="mt-6 h-[54px] items-center justify-center rounded-full bg-lime active:opacity-80"
              >
                <Text className="font-jk-b text-body text-ink">Yes, it is a delivery</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => onSubmit({ isDelivery: false })}
                className="mt-2.5 h-[50px] items-center justify-center rounded-card bg-field active:opacity-70"
              >
                <Text className="font-jk-b text-sub text-ink">
                  {busy ? 'Generating…' : 'No, a visitor'}
                </Text>
              </Pressable>
            </Animated.View>
          </View>
        ) : (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Animated.View
              entering={SlideInDown.duration(220)}
              className="rounded-t-[28px] bg-card px-6 pt-3"
              style={{ paddingBottom: insets.bottom + 20 }}
            >
              {/* Grab handle — the affordance that says this panel came from the
                  bottom edge and can be dismissed back to it. */}
              <View className="mb-5 h-1 w-10 self-center rounded-full bg-hair" />

              <Text className="font-jk-xb text-[21px] leading-7 tracking-tight text-ink">
                Delivery instructions
              </Text>
              <Text className="mt-2 font-jk text-sub text-muted">
                Sent to the rider along with the code. Optional — leave it empty and the code
                still works.
              </Text>

              <Controller
                control={control}
                name="note"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    testID="delivery-note-input"
                    accessibilityLabel="Delivery instructions"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    editable={!busy}
                    multiline
                    numberOfLines={4}
                    // Caps typing, so the schema below is the backstop for a
                    // paste or a dictation that arrives over the limit rather
                    // than something a resident meets by typing.
                    maxLength={MAX_DELIVERY_NOTE_LENGTH}
                    textAlignVertical="top"
                    placeholder="Leave it at the gate with the guard, house 14 — the blue gate on the left."
                    placeholderTextColor="#8b9096"
                    className={`mt-5 h-[120px] rounded-field bg-field p-4 font-jk text-body text-ink ${
                      errors.note ? 'border border-coral' : ''
                    }`}
                  />
                )}
              />

              <Text
                className={`mt-2 text-right font-jk text-micro ${
                  errors.note ? 'text-coral-ink' : 'text-muted'
                }`}
              >
                {errors.note?.message ?? `${remaining} characters left`}
              </Text>

              <Pressable
                accessibilityRole="button"
                // Enabled with an empty note ON PURPOSE: the note is optional,
                // so "" already satisfies every rule. The only thing that dims
                // this button is a note over the length the server would refuse.
                disabled={busy || Boolean(errors.note)}
                onPress={() => void submitNote()}
                className={`mt-4 h-[54px] items-center justify-center rounded-full bg-lime active:opacity-80 ${
                  errors.note ? 'opacity-40' : ''
                }`}
              >
                <Text className="font-jk-b text-body text-ink">
                  {busy ? 'Generating…' : 'Generate code'}
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => setStep('ask')}
                className="mt-2.5 h-[50px] items-center justify-center rounded-card active:opacity-70"
              >
                <Text className="font-jk-b text-sub text-muted">Back</Text>
              </Pressable>
            </Animated.View>
          </KeyboardAvoidingView>
        )}
      </View>
    </Modal>
  );
}
