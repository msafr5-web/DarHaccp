import { tokenStorage } from '../storage';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setAuthToken, setUnauthorizedHandler } from '../api/client';
import type { Role, User } from '../api/types';
import { registerForPushNotifications, unregisterPushNotifications } from '../notifications';

const TOKEN_KEY = 'dar_haccp_token';

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Mirrors the backend permission matrix (UI only — the server enforces it). */
  can: (permission: 'dashboard' | 'capa:update' | 'capa:verify' | 'alert:manage') => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

const UI_PERMISSIONS: Record<string, Role[]> = {
  dashboard: ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER', 'KITCHEN_SUPERVISOR'],
  'capa:update': ['ADMIN', 'HACCP_OFFICER', 'KITCHEN_SUPERVISOR'],
  'capa:verify': ['ADMIN', 'HACCP_OFFICER'],
  'alert:manage': ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER', 'KITCHEN_SUPERVISOR'],
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const clearSession = useCallback(async () => {
    setAuthToken(null);
    setUser(null);
    await tokenStorage.remove(TOKEN_KEY);
  }, []);

  // Restore session from the device keychain on launch.
  useEffect(() => {
    setUnauthorizedHandler(() => void clearSession());
    (async () => {
      try {
        const token = await tokenStorage.get(TOKEN_KEY);
        if (token) {
          setAuthToken(token);
          setUser(await api<User>('/auth/me'));
          void registerForPushNotifications();
        }
      } catch {
        await clearSession();
      } finally {
        setLoading(false);
      }
    })();
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { token, user: u } = await api<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: { email: email.trim(), password },
    });
    await tokenStorage.set(TOKEN_KEY, token);
    setAuthToken(token);
    setUser(u);
    void registerForPushNotifications();
  }, []);

  const signOut = useCallback(async () => {
    await unregisterPushNotifications();
    await clearSession();
  }, [clearSession]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      signIn,
      signOut,
      can: (p) => !!user && (UI_PERMISSIONS[p] ?? []).includes(user.role),
    }),
    [user, loading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
