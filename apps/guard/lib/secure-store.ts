import AsyncStorage from '@react-native-async-storage/async-storage';
import * as aesjs from 'aes-js';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/**
 * Session storage for Supabase Auth on React Native.
 *
 * `expo-secure-store` caps a value at ~2048 bytes and a Supabase session is
 * larger than that, so storing the session in SecureStore directly fails — and
 * fails *intermittently*, because session size varies with the claims in the
 * JWT. A setup that works in development can break the moment a token grows.
 *
 * The documented workaround, and what this implements: generate an AES-256 key
 * per value, keep the KEY in SecureStore (small enough to fit, hardware-backed)
 * and the CIPHERTEXT in AsyncStorage (no size limit, but unencrypted at rest —
 * which is fine, because without the key it is noise).
 *
 * Do not "simplify" this to plain AsyncStorage. That would put a live session
 * token in unencrypted storage, readable by anything with filesystem access on
 * a rooted or jailbroken device.
 */
export class LargeSecureStore {
  private async encrypt(key: string, value: string): Promise<string> {
    // expo-crypto avoids needing the react-native-get-random-values polyfill
    const encryptionKey = Crypto.getRandomBytes(256 / 8);
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));

    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));
    return aesjs.utils.hex.fromBytes(encryptedBytes);
  }

  private async decrypt(key: string, value: string): Promise<string | null> {
    const encryptionKeyHex = await SecureStore.getItemAsync(key);
    if (!encryptionKeyHex) return null;

    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(encryptionKeyHex),
      new aesjs.Counter(1),
    );
    const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(value));
    return aesjs.utils.utf8.fromBytes(decryptedBytes);
  }

  async getItem(key: string): Promise<string | null> {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) return null;

    try {
      return await this.decrypt(key, encrypted);
    } catch {
      // Ciphertext without its key is unrecoverable — most likely the app was
      // reinstalled (SecureStore cleared, AsyncStorage kept). Drop the orphan
      // so the user gets a clean sign-in instead of a crash loop.
      await this.removeItem(key);
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    const encrypted = await this.encrypt(key, value);
    await AsyncStorage.setItem(key, encrypted);
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }
}
