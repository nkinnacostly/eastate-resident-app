import { codeFromQr } from '@estate/core';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TorchIcon } from '@/components/icons';
import { PrimaryButton } from '@/components/ui';
import { checkCode } from '@/lib/check';
import { useShift } from '@/lib/shift';
import { holdVerdict } from '@/lib/verdicts';

/**
 * Scan a visitor's QR pass.
 *
 * WORKS WITH NO SIGNAL, and that is the design rather than a bonus. The QR
 * holds the code and nothing else (codeFromQr in @estate/core), the camera
 * decodes it on the phone -- AVFoundation on iOS, and on Android the BUNDLED
 * ML Kit barcode model that expo-camera 17 (SDK 54) links as
 * com.google.mlkit:barcode-scanning, so there is no model download from Play
 * Services waiting on a network the gate does not have. The code then goes
 * through lib/check, the same function the keypad uses: server when online,
 * the pool on this phone when not.
 *
 * Only QR is decoded. Every other symbology is a way to misread a parcel label
 * or a membership card as an attempt at the gate.
 */
export default function Scan() {
  const router = useRouter();
  const { post, online, authorisationExpired, refresh } = useShift();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // The camera reports the same QR many times a second while it stays in
  // view. The first good read claims the scan; every later one is dropped, or
  // one visitor would become several verifications and the second would come
  // back "already used".
  const claimed = useRef(false);
  // A foreign QR is reported once, not on every frame it stays in view.
  const lastForeign = useRef<string | null>(null);
  // Asked once per visit. On Android a refusal still reports canAskAgain, so
  // asking whenever permission changed would put the prompt straight back up.
  const asked = useRef(false);

  // The keypad's own gate, repeated here because this screen can be reached
  // without passing the keypad.
  const canCheck = Boolean(post) && (online || !authorisationExpired);

  // Only asked when the camera is about to be used. A phone that cannot check
  // a code has no reason to want the camera, and a prompt there teaches the
  // guard to tap "Don't Allow" -- which the OS then remembers.
  useEffect(() => {
    if (!canCheck || asked.current) return;
    if (!permission || permission.granted || !permission.canAskAgain) return;
    asked.current = true;
    void requestPermission();
  }, [canCheck, permission, requestPermission]);

  // Reachable with no history -- a link into the app, or a cold start.
  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  const onScanned = async ({ data }: BarcodeScanningResult) => {
    if (claimed.current || !post || !canCheck) return;

    const code = codeFromQr(data);
    if (!code) {
      // Not recorded as a gate attempt. Nothing was presented as a code, the
      // same as a keypad entry the schema refuses never reaches the log.
      if (lastForeign.current !== data) {
        lastForeign.current = data;
        setNotice('That QR is not a visitor code. Ask for the code instead.');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
      return;
    }

    claimed.current = true;
    setNotice(null);
    setChecking(code);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    try {
      const verdict = await checkCode(post.estate_id, code, online);
      // Replace, so the verdict's "done" goes back to the keypad rather than
      // to a camera still pointed at the code it just burned.
      router.replace({ pathname: '/verdict', params: { id: holdVerdict(verdict) } });
    } catch (e) {
      // Stays claimed until the guard taps to try again. The QR is still in
      // front of the camera, so re-arming on its own would retry in a loop.
      setChecking(null);
      setFailed(true);
      setNotice(`Could not check ${code}. ${(e as Error).message}`);
    } finally {
      void refresh();
    }
  };

  const scanAgain = () => {
    claimed.current = false;
    lastForeign.current = null;
    setFailed(false);
    setNotice(null);
  };

  return (
    <View className="flex-1 bg-ink">
      {permission?.granted && canCheck ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={(result) => void onScanned(result)}
        />
      ) : null}

      <SafeAreaView className="flex-1" edges={['top', 'bottom']}>
        <View className="flex-row items-center justify-between px-4 pt-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={close}
            className="h-10 w-10 items-center justify-center rounded-full bg-ink/70"
          >
            <Text className="font-jk-b text-body text-canvas">✕</Text>
          </Pressable>
          <Text className="font-jk-xb text-body text-canvas">Scan visitor QR</Text>
          {permission?.granted && canCheck ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={torch ? 'Turn torch off' : 'Turn torch on'}
              accessibilityState={{ selected: torch }}
              onPress={() => setTorch((on) => !on)}
              className={`h-10 w-10 items-center justify-center rounded-full ${
                torch ? 'bg-lime' : 'bg-ink/70'
              }`}
            >
              <TorchIcon color={torch ? '#16181c' : '#f7f9fb'} size={20} />
            </Pressable>
          ) : (
            <View className="h-10 w-10" />
          )}
        </View>

        <View className="flex-1 items-center justify-center px-6">
          {!canCheck ? (
            <Text className="text-center font-jk-sb text-body text-canvas">
              {post
                ? 'This phone has been out of contact for longer than a code lasts. Get signal and sync before checking anyone in.'
                : 'No gate post on this phone, so there is nothing to check codes against.'}
            </Text>
          ) : !permission ? (
            <ActivityIndicator color="#f7f9fb" />
          ) : !permission.granted ? (
            <View className="items-center">
              <Text className="text-center font-jk-sb text-body text-canvas">
                Camera access is off, so this phone cannot scan. Allow it, or type the code
                instead.
              </Text>
              <PrimaryButton
                title="Allow camera"
                className="mt-5 w-56"
                // After a refusal the OS will not show its prompt again; only
                // Settings can turn the camera back on.
                onPress={() =>
                  permission.canAskAgain ? void requestPermission() : void Linking.openSettings()
                }
              />
            </View>
          ) : (
            <View
              accessibilityLabel="Scanning area"
              className="h-64 w-64 rounded-[28px] border-4 border-lime"
            />
          )}
        </View>

        <View className="px-5 pb-4">
          {checking ? (
            <View className="mb-4 flex-row items-center justify-center gap-2">
              <ActivityIndicator color="#cdf24a" />
              <Text className="font-jk-b text-body text-canvas">
                Checking {checking}
                {online ? '' : ' on this phone'}…
              </Text>
            </View>
          ) : notice ? (
            <Text className="mb-4 text-center font-jk-sb text-body text-coral">{notice}</Text>
          ) : permission?.granted && canCheck ? (
            <Text className="mb-4 text-center font-jk-sb text-sub text-canvas/80">
              {online
                ? 'Hold the QR inside the square.'
                : 'Hold the QR inside the square. No signal: checking against the codes on this phone.'}
            </Text>
          ) : null}

          {failed ? <PrimaryButton title="Scan again" onPress={scanAgain} className="mb-2.5" /> : null}

          <Pressable
            accessibilityRole="button"
            onPress={close}
            className="h-12 items-center justify-center rounded-2xl border border-canvas/30 active:opacity-70"
          >
            <Text className="font-jk-b text-sub text-canvas/85">Type the code instead</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
