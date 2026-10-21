import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { api, ApiError, errorMessage } from '../api/client';
import { cachedValue, cacheValue } from '../offline';

/**
 * Loads `path` whenever the screen gains focus. The last good response is cached on the
 * device so lists stay readable without a connection (flagged with `offline`).
 */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api<T>(path);
      setData(result);
      setOffline(false);
      void cacheValue(path, result);
    } catch (e) {
      const cached = e instanceof ApiError && e.status === 0 ? await cachedValue<T>(path) : undefined;
      if (cached) {
        setData(cached);
        setOffline(true);
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setLoading(false);
    }
  }, [path]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { data, error, loading, offline, reload, setData };
}
