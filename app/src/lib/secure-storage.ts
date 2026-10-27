// Session storage for supabase-js backed by the OS keystore (expo-secure-store).
// SecureStore caps one value at 2 KB and a session is larger, so values are split into chunks.
import * as SecureStore from 'expo-secure-store';

// 600 chars ≤ 1800 bytes even if every char takes 3 bytes in UTF-8 (e.g. non-Latin names).
const CHUNK = 600;
const pointerKey = (key: string) => `${key}.ptr`; // "<generation>:<chunk count>"
const chunkKey = (key: string, gen: string, i: number) => `${key}.${gen}.${i}`;

// One write at a time: a token refresh and a sign-in must not interleave chunks.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

async function readPointer(key: string) {
  const ptr = await SecureStore.getItemAsync(pointerKey(key));
  if (!ptr) return null;
  const [gen, n] = ptr.split(':');
  return { gen: gen!, n: Number(n) };
}

async function deleteChunks(key: string, p: { gen: string; n: number } | null) {
  if (!p) return;
  await Promise.all(Array.from({ length: p.n }, (_, i) => SecureStore.deleteItemAsync(chunkKey(key, p.gen, i))));
}

export const secureStorage = {
  async getItem(key: string) {
    const p = await readPointer(key);
    if (!p) return null;
    const parts = await Promise.all(Array.from({ length: p.n }, (_, i) => SecureStore.getItemAsync(chunkKey(key, p.gen, i))));
    return parts.some((x) => x === null) ? null : parts.join('');
  },

  // New chunks go under a new generation; the pointer switches last, then old chunks go.
  // A crash mid-write leaves the previous value intact.
  setItem: (key: string, value: string) =>
    serial(async () => {
      const old = await readPointer(key);
      const gen = Date.now().toString(36);
      const parts = value.match(new RegExp(`[\\s\\S]{1,${CHUNK}}`, 'g')) ?? [''];
      await Promise.all(parts.map((part, i) => SecureStore.setItemAsync(chunkKey(key, gen, i), part)));
      await SecureStore.setItemAsync(pointerKey(key), `${gen}:${parts.length}`);
      await deleteChunks(key, old);
    }),

  removeItem: (key: string) =>
    serial(async () => {
      const old = await readPointer(key);
      await SecureStore.deleteItemAsync(pointerKey(key));
      await deleteChunks(key, old);
    }),
};
