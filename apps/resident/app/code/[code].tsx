import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import { Linking, Modal, Platform, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { MailIcon, QrIcon, ShareIcon, SmsIcon, WhatsAppIcon } from '@/components/icons';
import { QrCode } from '@/components/qr-code';
import { Card, CodeText, Eyebrow, PrimaryButton, SecondaryButton } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useCodes } from '@/lib/codes';
import { PRIVACY_URL, shareMessage, validUntil } from '@/lib/format';

/** The privacy link as it can be printed: an image cannot carry a tappable one. */
const PRIVACY_PRINTED = PRIVACY_URL.replace(/^https:\/\//, '');

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

  // Read off the stored row, not from navigation state, so re-sharing this code
  // later — from the Codes tab, or after the app restarted — carries the same
  // instructions the rider was originally sent.
  const deliveryNote = row?.delivery_note ?? null;
  const message = shareMessage(code, estateName, expires, deliveryNote);

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
   * Send the pass card itself, QR and all, as an image.
   *
   * What the visitor gets is exactly the lime card on this screen -- captured
   * from it, not drawn separately, so it cannot say something different. It
   * goes through the OS share sheet because no messaging app accepts an image
   * through its URL scheme, and expo-sharing is what hands Android a file.
   *
   * The image carries everything the text message does, the privacy link
   * included (printed, since an image cannot hold a tappable one). If the
   * capture or the sheet is unavailable the resident still gets the text
   * message rather than nothing.
   */
  const passCard = useRef<View>(null);
  const sendPass = async () => {
    setSheet(false);
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('sharing unavailable');
      const uri = await captureRef(passCard, { format: 'png', quality: 1, result: 'tmpfile' });
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        UTI: 'public.png',
        dialogTitle: `Send ${code}`,
      });
    } catch {
      await Share.share({ message });
    }
  };

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
      {/* Scrolls only when it has to: the pass with a QR and a delivery note
          is taller than a small phone, and the send button must stay
          reachable. On anything bigger the spacer pins the buttons down. */}
      <ScrollView
        className="flex-1"
        contentContainerClassName="flex-grow px-5 pb-6"
        showsVerticalScrollIndicator={false}
      >
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

        {/* The pass. Captured as the image "Send QR pass" sends, so anything
            added inside this card is something the visitor receives. Not
            collapsable: Android would otherwise flatten the wrapper away and
            leave nothing to capture. The wrapper is painted in the screen's
            own colour so the card's rounded corners come out light rather than
            transparent -- WhatsApp re-encodes images as JPEG, and transparency
            there turns black. */}
        <View ref={passCard} testID="visitor-pass" collapsable={false} className="mt-4 bg-canvas">
          <View className="items-center rounded-card bg-lime px-5 py-6">
            <Text className="font-jk-b text-sub text-ink" numberOfLines={1}>
              {estateName}
            </Text>
            <View className="mt-4 overflow-hidden rounded-[14px]">
              <QrCode value={code} size={176} />
            </View>
            <CodeText code={code} className="mt-3.5 text-[40px]" />
            <Text className="mt-1 font-jk-sb text-sub text-ink/70">{validUntil(expires)}</Text>

            {deliveryNote ? (
              // Inside the pass, not beside it: a rider sent the image alone
              // must still get the instructions. Shown verbatim so the resident
              // can check what the rider will read before sending it.
              <View className="mt-4 w-full rounded-[14px] bg-ink/5 px-3.5 py-3">
                <Eyebrow className="text-ink/60">DELIVERY</Eyebrow>
                <Text className="mt-1.5 font-jk text-sub leading-5 text-ink">{deliveryNote}</Text>
              </View>
            ) : null}

            <Eyebrow className="mt-4 text-ink/60">ONE ENTRY ONLY</Eyebrow>
            <Text className="mt-1.5 text-center font-jk text-micro text-ink/60">
              Show the QR at the gate or read out the code.{'\n'}What the gate records:{' '}
              {PRIVACY_PRINTED}
            </Text>
          </View>
        </View>

        {/* A VISITOR / GATE pair sat here reading "Not set" and "Main". Neither
            is backed by a column: "Main" was invented, so the screen stated a
            gate the estate may not have. Restore it when visitors and gates are
            modelled — until then the code and its expiry are what we know. */}

        {row?.is_delivery && !deliveryNote ? (
          <Text className="mt-3 text-center font-jk text-micro text-muted">
            Delivery code · no instructions added.
          </Text>
        ) : null}

        <View className="min-h-6 flex-1" />

        <View className="gap-2.5">
          <PrimaryButton title="Send to visitor" onPress={() => setSheet(true)} />
          <SecondaryButton title={copied ? 'Copied' : 'Copy code'} onPress={copy} />
        </View>
      </ScrollView>

      <Modal visible={sheet} transparent animationType="slide" onRequestClose={() => setSheet(false)}>
        <Pressable className="flex-1 bg-ink/40" onPress={() => setSheet(false)} />
        <View className="rounded-t-sheet bg-canvas px-5 pb-8 pt-5">
          <View className="mx-auto mb-4 h-1 w-9 rounded-full bg-hair" />
          <Text className="font-jk-xb text-body text-ink">Send {code}</Text>

          {/* Ink, not lime: the WhatsApp tile below keeps the lime, and two
              lime controls in one sheet would leave neither one primary. */}
          <Pressable
            accessibilityRole="button"
            onPress={() => void sendPass()}
            className="mt-3 h-[54px] flex-row items-center justify-center gap-2.5 rounded-card bg-ink active:opacity-80"
          >
            <QrIcon color="#cdf24a" size={22} />
            <Text className="font-jk-b text-body text-canvas">Send QR pass</Text>
          </Pressable>
          <Text className="mt-2 font-jk text-micro text-muted">
            The card above as an image. The guard scans it, even with no signal at the gate.
          </Text>

          <Eyebrow className="mt-4 text-muted">OR SEND AS TEXT</Eyebrow>
          <Card className="mt-2 p-3.5">
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
