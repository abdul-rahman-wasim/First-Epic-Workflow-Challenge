// Session storage for supabase-js backed by the OS keystore (expo-secure-store).
// SecureStore caps one value at 2 KB and a session is larger, so values are split into chunks.
import * as SecureStore from 'expo-secure-store';

const CHUNK = 1800;
const countKey = (key: string) => `${key}.n`;
const chunkKey = (key: string, i: number) => `${key}.${i}`;

async function removeItem(key: string) {
  const n = Number((await SecureStore.getItemAsync(countKey(key))) ?? 0);
  await Promise.all(Array.from({ length: n }, (_, i) => SecureStore.deleteItemAsync(chunkKey(key, i))));
  await SecureStore.deleteItemAsync(countKey(key));
}

export const secureStorage = {
  async getItem(key: string) {
    const n = await SecureStore.getItemAsync(countKey(key));
    if (!n) return null;
    const parts = await Promise.all(Array.from({ length: Number(n) }, (_, i) => SecureStore.getItemAsync(chunkKey(key, i))));
    return parts.some((p) => p === null) ? null : parts.join('');
  },
  async setItem(key: string, value: string) {
    await removeItem(key);
    const parts = value.match(new RegExp(`[\\s\\S]{1,${CHUNK}}`, 'g')) ?? [''];
    await Promise.all(parts.map((p, i) => SecureStore.setItemAsync(chunkKey(key, i), p)));
    await SecureStore.setItemAsync(countKey(key), String(parts.length));
  },
  removeItem,
};
