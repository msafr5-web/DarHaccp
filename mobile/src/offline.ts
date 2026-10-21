import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { api, ApiError } from './api/client';

/**
 * Offline mode (SWOT weakness: network / power outages in the kitchen).
 * - Forms opened online are cached so they can still be opened and filled offline.
 * - Submissions made offline go to an outbox with the real measurement time and a
 *   client-generated id; they are replayed automatically when the connection returns.
 *   The server de-duplicates replays by `clientRef` and accepts readings up to 24h old.
 */

// ---------------------------------------------------------------- tiny persistent key/value store

const memory = new Map<string, string>();

function fileFor(key: string) {
  return new File(Paths.document, `${key}.json`);
}

async function readKey<T>(key: string, fallback: T): Promise<T> {
  try {
    let raw: string | null | undefined;
    if (Platform.OS === 'web') raw = globalThis.localStorage?.getItem(key);
    else {
      const f = fileFor(key);
      raw = f.exists ? await f.text() : null;
    }
    raw ??= memory.get(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function writeKey(key: string, value: unknown): Promise<void> {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(key, raw);
    else {
      const f = fileFor(key);
      if (!f.exists) f.create();
      await f.write(raw);
    }
  } catch (e) {
    console.warn('Offline storage write failed', e);
  }
}

// ---------------------------------------------------------------- form cache

const FORMS_KEY = 'dar_haccp_forms_cache';

export async function cacheForm(payload: string, form: unknown) {
  const all = await readKey<Record<string, unknown>>(FORMS_KEY, {});
  all[payload] = form;
  await writeKey(FORMS_KEY, all);
}

export async function cachedForm<T>(payload: string): Promise<T | undefined> {
  return (await readKey<Record<string, T>>(FORMS_KEY, {}))[payload];
}

export async function cacheValue(key: string, value: unknown) {
  await writeKey(`dar_haccp_cache_${key}`, value);
}

export async function cachedValue<T>(key: string): Promise<T | undefined> {
  return readKey<T | undefined>(`dar_haccp_cache_${key}`, undefined);
}

// ---------------------------------------------------------------- outbox

export interface OutboxItem {
  clientRef: string;
  department: string;
  title: string;
  body: Record<string, unknown>;
  queuedAt: string;
  error?: string;
}

const OUTBOX_KEY = 'dar_haccp_outbox';
const REJECTED_KEY = 'dar_haccp_outbox_rejected';
const listeners = new Set<() => void>();

export function subscribeOutbox(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const notify = () => listeners.forEach((l) => l());

/** RFC 4122 v4 id; uses the platform CSPRNG when available. */
export function newClientRef(): string {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const getOutbox = () => readKey<OutboxItem[]>(OUTBOX_KEY, []);
export const getRejected = () => readKey<OutboxItem[]>(REJECTED_KEY, []);

export async function enqueue(item: OutboxItem) {
  const items = await getOutbox();
  if (!items.some((i) => i.clientRef === item.clientRef)) items.push(item);
  await writeKey(OUTBOX_KEY, items);
  notify();
}

export async function clearRejected() {
  await writeKey(REJECTED_KEY, []);
  notify();
}

let flushing: Promise<{ sent: number; remaining: number }> | null = null;

/** Sends queued records in order. Stops at the first network failure; server rejections are set aside. */
export function flushOutbox() {
  flushing ??= (async () => {
    let sent = 0;
    try {
      const items = await getOutbox();
      const remaining = [...items];
      const rejected = await getRejected();
      for (const item of items) {
        try {
          await api(`/kitchens/${item.department.toLowerCase()}/records`, { method: 'POST', body: item.body });
          sent++;
          remaining.shift();
        } catch (e) {
          if (e instanceof ApiError && e.status !== 0 && e.status !== 401 && e.status < 500) {
            rejected.push({ ...item, error: e.message });
            remaining.shift();
            continue;
          }
          break; // still offline, session expired or server error: retry later in the same order
        }
      }
      await writeKey(OUTBOX_KEY, remaining);
      await writeKey(REJECTED_KEY, rejected);
      return { sent, remaining: remaining.length };
    } finally {
      flushing = null;
      notify();
    }
  })();
  return flushing;
}
