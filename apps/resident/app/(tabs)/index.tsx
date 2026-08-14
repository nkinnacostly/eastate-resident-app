import { MAX_ACTIVE_CODES_PER_RESIDENT } from '@estate/core';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listMyCodes, mintCode, type CodeRow } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function ResidentHome() {
  const { session, loading, signIn, signOut, memberships, activeEstateId } = useAuth();

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return session ? (
    <CodesScreen
      estateId={activeEstateId}
      estateName={memberships.find((m) => m.estate_id === activeEstateId)?.estate_name}
      onSignOut={signOut}
    />
  ) : (
    <SignInScreen onSignIn={signIn} />
  );
}

function SignInScreen({
  onSignIn,
}: {
  onSignIn: (email: string, password: string) => Promise<{ error: string | null }>;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const { error } = await onSignIn(email.trim(), password);
    setBusy(false);
    if (error) Alert.alert('Sign in failed', error);
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Estate Access</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <Button title={busy ? 'Signing in…' : 'Sign in'} onPress={submit} disabled={busy} />
    </SafeAreaView>
  );
}

function CodesScreen({
  estateId,
  estateName,
  onSignOut,
}: {
  estateId: string | null;
  estateName?: string;
  onSignOut: () => Promise<void>;
}) {
  const [codes, setCodes] = useState<CodeRow[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setCodes(await listMyCodes());
    } catch (e) {
      Alert.alert('Could not load codes', (e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const generate = async () => {
    if (!estateId) return;
    setBusy(true);
    try {
      const res = await mintCode(estateId);
      // These are RESULTS, not errors — the function deliberately does not
      // raise for expected outcomes (Technical Design §3.1).
      switch (res.result) {
        case 'ok':
          Alert.alert('New code', res.code, [{ text: 'OK' }]);
          break;
        case 'code_limit_reached':
          Alert.alert(
            'Code limit reached',
            `You can hold ${MAX_ACTIVE_CODES_PER_RESIDENT} live codes at once. ` +
              'Wait for one to be used or to expire.',
          );
          break;
        case 'rate_limited':
          Alert.alert('Slow down', 'Too many requests just now. Try again in a minute.');
          break;
        case 'not_a_resident':
          Alert.alert('No access', 'You are not an active resident at this estate.');
          break;
        default:
          Alert.alert('Could not generate a code', 'Please try again.');
      }
      await refresh();
    } catch (e) {
      Alert.alert('Could not generate a code', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const live = codes.filter((c) => c.status === 'live').length;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{estateName ?? 'Estate Access'}</Text>
        <Button title="Sign out" onPress={onSignOut} />
      </View>

      <Text style={styles.subtle}>
        {live} of {MAX_ACTIVE_CODES_PER_RESIDENT} live codes
      </Text>

      <Button
        title={busy ? 'Generating…' : 'Generate visitor code'}
        onPress={generate}
        disabled={busy || !estateId}
      />

      <FlatList
        style={styles.list}
        data={codes}
        keyExtractor={(c) => c.id}
        onRefresh={refresh}
        refreshing={false}
        ListEmptyComponent={<Text style={styles.subtle}>No codes yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.code}>{item.code}</Text>
            <Text style={styles.subtle}>
              {item.status}
              {item.used_at ? ` · used ${new Date(item.used_at).toLocaleString()}` : ''}
            </Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 24, fontWeight: '600' },
  subtle: { opacity: 0.6 },
  input: { borderWidth: 1, borderColor: '#8883', borderRadius: 8, padding: 12 },
  list: { marginTop: 8 },
  row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#8883' },
  code: { fontSize: 22, letterSpacing: 4, fontVariant: ['tabular-nums'] },
});
