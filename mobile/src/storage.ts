import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** Device keychain on iOS/Android; localStorage in the web build (SecureStore has no web implementation). */
export const tokenStorage = {
  get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return Promise.resolve(globalThis.localStorage?.getItem(key) ?? null);
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') return globalThis.localStorage?.setItem(key, value);
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') return globalThis.localStorage?.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  },
};
