import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Modal, Platform, Pressable, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MailIcon, ShareIcon, SmsIcon, WhatsAppIcon } from '@/components/icons';
import { Card, CodeText, Eyebrow, PrimaryButton, SecondaryButton } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useCodes } from '@/lib/codes';
import { shareMessage, validUntil } from '@/lib/format';

export default function CodeIssued() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { memberships, activeEstateId } = useAuth();
  const { codes } = useCodes();
  const router = useRouter();
  const [sheet, setSheet] = useState(false);
  const [copied, setCopied] = useState(false);

  // Resolved from state rather than passed through route params. A timestamp
  // in a URL is a serialisation bug waiting to happen — a `+00:00` offset
  // decodes as a space and renders "Invalid Date".
  const row = codes.find((c) => c.code === code);
  const expires = row?.expires_at ?? '';

  const estateName = memberships.find((m) => m.estate_id === activeEstateId)?.estate_name ?? 'the estate';
  const message = shareMessage(code, estateName, expires);

  // Held so the "Copied" reset can be cancelled — otherwise leaving the screen
  // within 1.6s sets state on an unmounted component.
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const copy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1600);
  };

  /**
   * Try the app's own URL scheme, fall back to the OS share sheet.
   *
   * canOpenURL returns false when the app isn't installed (and on iOS unless
   * the scheme is declared in app.json's LSApplicationQueriesSchemes), so the
   * fallback is the common path, not the edge case.
   */
  const sendVia = async (scheme: string | null) => {
    setSheet(false);
    try {
      if (scheme) {
        const url = scheme + encodeURIComponent(message);
        if (await Linking.canOpenURL(url)) {
          await Linking.openURL(url);
          return;
        }
      }
      await Share.share({ message });
    } catch {
      await Share.share({ message });
    }
  };

  const smsScheme = Platform.OS === 'ios' ? 'sms:&body=' : 'sms:?body=';

  /**
   * This screen is reachable with no history — a deep link, or a push
   * notification tap. Calling back() there dispatches GO_BACK at the root, and
   * no navigator handles it. Same guard expo-router uses in its own Unmatched
   * screen (expo-router 6.0.24).
   */
  const dismiss = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top', 'bottom']}>
      <View className="flex-1 px-5 pb-6">
        <View className="mt-2 flex-row items-center justify-between">
          <Text className="font-jk-b text-sub text-ink">Your code</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={dismiss}
            className="h-[30px] w-[30px] items-center justify-center rounded-full bg-field"
          >
            <Text className="font-jk-b text-sub text-muted">✕</Text>
          </Pressable>
        </View>

        <Card className="mt-4 items-center bg-lime px-5 py-7">
          <Eyebrow className="text-ink/60">ONE ENTRY ONLY</Eyebrow>
          <CodeText code={code} className="mt-3.5 text-[46px]" />
          <Text className="mt-3 font-jk-sb text-sub text-ink/70">{validUntil(expires)}</Text>
        </Card>

        {/* Not backed by the schema yet — shown as the design specifies. */}
        <View className="mt-3.5 flex-row gap-2.5">
          <Card className="flex-1 p-3.5">
            <Text className="font-jk-b text-label tracking-label text-muted">VISITOR</Text>
            <Text className="mt-1.5 font-jk-b text-sub text-ink">Not set</Text>
          </Card>
          <Card className="flex-1 p-3.5">
            <Text className="font-jk-b text-label tracking-label text-muted">GATE</Text>
            <Text className="mt-1.5 font-jk-b text-sub text-ink">Main</Text>
          </Card>
        </View>

        <View className="flex-1" />

        <View className="gap-2.5">
          <PrimaryButton title="Send to visitor" onPress={() => setSheet(true)} />
          <SecondaryButton title={copied ? 'Copied' : 'Copy code'} onPress={copy} />
        </View>
      </View>

      <Modal visible={sheet} transparent animationType="slide" onRequestClose={() => setSheet(false)}>
        <Pressable className="flex-1 bg-ink/40" onPress={() => setSheet(false)} />
        <View className="rounded-t-sheet bg-canvas px-5 pb-8 pt-5">
          <View className="mx-auto mb-4 h-1 w-9 rounded-full bg-hair" />
          <Text className="font-jk-xb text-body text-ink">Send {code}</Text>

          <Card className="mt-3 p-3.5">
            <Text className="font-jk text-sub text-muted">“{message}”</Text>
          </Card>

          <View className="mt-4 flex-row gap-3">
            <ShareTarget label="WhatsApp" highlight onPress={() => sendVia('whatsapp://send?text=')}>
              <WhatsAppIcon color="#16181c" size={26} />
            </ShareTarget>
            <ShareTarget label="SMS" onPress={() => sendVia(smsScheme)}>
              <SmsIcon color="#16181c" size={26} />
            </ShareTarget>
            <ShareTarget label="Email" onPress={() => sendVia('mailto:?body=')}>
              <MailIcon color="#16181c" size={26} />
            </ShareTarget>
            <ShareTarget label="More" onPress={() => sendVia(null)}>
              <ShareIcon color="#16181c" size={26} />
            </ShareTarget>
          </View>

          <SecondaryButton title="Cancel" onPress={() => setSheet(false)} className="mt-4" />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ShareTarget({
  label,
  children,
  onPress,
  highlight = false,
}: {
  label: string;
  children: React.ReactNode;
  onPress: () => void;
  highlight?: boolean;
}) {
  return (
    <Pressable className="flex-1 items-center" accessibilityRole="button" onPress={onPress}>
      <View
        className={`h-14 w-full items-center justify-center rounded-card ${highlight ? 'bg-lime' : 'bg-card'}`}
      >
        {children}
      </View>
      <Text className="mt-1.5 font-jk-sb text-micro text-ink">{label}</Text>
    </Pressable>
  );
}
