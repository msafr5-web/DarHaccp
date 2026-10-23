import { Platform } from 'react-native';

const KEY = 'dar_haccp_after_login';
let memory: string | null = null;

/** Remembers where to go after sign-in (e.g. a scanned QR form), across the e-mail login link on the web. */
export function setPendingRedirect(path: string) {
  memory = path;
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, JSON.stringify({ path, at: Date.now() }));
  } catch { /* storage unavailable */ }
}

/** Returns and clears the pending path (ignored after 30 minutes). */
export function takePendingRedirect(): string | null {
  let path = memory;
  memory = null;
  try {
    if (Platform.OS === 'web') {
      const raw = globalThis.localStorage?.getItem(KEY);
      globalThis.localStorage?.removeItem(KEY);
      const saved = raw ? (JSON.parse(raw) as { path: string; at: number }) : null;
      if (saved && Date.now() - saved.at < 30 * 60_000) path = saved.path;
    }
  } catch { /* ignore */ }
  return path;
}
