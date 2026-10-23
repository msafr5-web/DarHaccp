import { rememberCompany, rememberedCompany } from '../companyLink';
import { tokenStorage } from '../storage';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setAuthToken, setUnauthorizedHandler } from '../api/client';
import type { Role, User } from '../api/types';
import { registerForPushNotifications, unregisterPushNotifications } from '../notifications';

const TOKEN_KEY = 'dar_haccp_token';

export interface LoginChallenge {
  challengeId: string;
  email: string;
  expiresInSeconds: number;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  /** Step 1: company code + e-mail + password → an OTP is e-mailed. */
  startLogin: (email: string, password: string, companyCode?: string) => Promise<LoginChallenge>;
  /** Step 2: the e-mailed 6-digit code → session. */
  verifyOtp: (challengeId: string, code: string) => Promise<void>;
  resendOtp: (challengeId: string) => Promise<{ email: string }>;
  /** Last company code used on this device (pre-fills the login form). */
  lastCompanyCode: () => Promise<string | null>;
  isPlatform: boolean;
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
  'security:read': ['ADMIN'],
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

  const startLogin = useCallback(async (email: string, password: string, companyCode?: string) => {
    return api<LoginChallenge>('/auth/login', {
      method: 'POST',
      body: { email: email.trim(), password, ...(companyCode ? { companyCode } : {}) },
    });
  }, []);

  const verifyOtp = useCallback(async (challengeId: string, code: string) => {
    const { token, user: u, tenant } = await api<{ token: string; user: User; tenant: User['tenant'] }>('/auth/verify-otp', {
      method: 'POST',
      body: { challengeId, code: code.trim() },
    });
    await tokenStorage.set(TOKEN_KEY, token);
    // Remember the company on this device for the branded sign-in page next time.
    if (tenant && u.role !== 'PLATFORM_ADMIN') await rememberCompany({ name: tenant.name, code: tenant.code });
    setAuthToken(token);
    setUser({ ...u, tenant });
    void registerForPushNotifications();
  }, []);

  const resendOtp = useCallback(
    (challengeId: string) => api<{ email: string }>('/auth/resend-otp', { method: 'POST', body: { challengeId } }),
    [],
  );
  const lastCompanyCode = useCallback(async () => (await rememberedCompany())?.code ?? null, []);

  const signOut = useCallback(async () => {
    await unregisterPushNotifications();
    await clearSession();
  }, [clearSession]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      startLogin,
      verifyOtp,
      resendOtp,
      lastCompanyCode,
      signOut,
      isPlatform: user?.role === 'PLATFORM_ADMIN',
      can: (p) => !!user && (UI_PERMISSIONS[p] as Role[]).includes(user.role),
    }),
    [user, loading, startLogin, verifyOtp, resendOtp, lastCompanyCode, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
