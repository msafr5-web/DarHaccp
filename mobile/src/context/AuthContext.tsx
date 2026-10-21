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
  can: (permission: UiPermission) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

const ALL: Role[] = ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER', 'KITCHEN_SUPERVISOR', 'CHEF'];
const MANAGERS: Role[] = ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER', 'KITCHEN_SUPERVISOR'];

/** Mirrors backend/src/config/permissions.ts — the UI hides what the server would refuse anyway. */
const UI_PERMISSIONS = {
  dashboard: MANAGERS,
  'capa:update': ['ADMIN', 'HACCP_OFFICER', 'KITCHEN_SUPERVISOR'],
  'capa:verify': ['ADMIN', 'HACCP_OFFICER'],
  'alert:manage': MANAGERS,
  'staff:read': MANAGERS,
  'incident:create': ALL,
  'incident:read': MANAGERS,
  'internal-audit:read': MANAGERS,
  'internal-audit:manage': ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER'],
  'recipe:read': ALL,
  'label:create': ['ADMIN', 'HACCP_OFFICER', 'KITCHEN_SUPERVISOR', 'CHEF'],
  'label:read': ALL,
  'contractor:read': MANAGERS,
  'contractor:manage': ['ADMIN', 'HSE_OFFICER'],
  'document:read': ALL,
} satisfies Record<string, Role[]>;

export type UiPermission = keyof typeof UI_PERMISSIONS;

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
      can: (p) => !!user && (UI_PERMISSIONS[p] as Role[]).includes(user.role),
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
