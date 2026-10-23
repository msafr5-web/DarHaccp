import { Platform } from 'react-native';
import { cachedValue, cacheValue } from './offline';

const KEY = 'dar_haccp_device_id';
let current: string | null = null;

/**
 * Stable identifier of this phone / browser, stored with every record as the filling device
 * (e.g. "AND-7K2Q9X", "WEB-M4T8PA"). Random — it carries no personal or hardware data.
 */
export async function deviceId(): Promise<string> {
  if (current) return current;
  const saved = await cachedValue<string>(KEY);
  if (saved) return (current = saved);
  const prefix = Platform.OS === 'web' ? 'WEB' : Platform.OS === 'ios' ? 'IOS' : 'AND';
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const suffix = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  current = `${prefix}-${suffix}`;
  await cacheValue(KEY, current);
  return current;
}
