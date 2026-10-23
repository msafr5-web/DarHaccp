import { Platform } from 'react-native';
import { API_URL } from './api/client';
import { tokenStorage } from './storage';

const KEY = 'dar_haccp_company';

export interface RememberedCompany {
  name: string;
  code: string;
}

/** The company opened through its login link is remembered on this device (branded sign-in). */
export async function rememberCompany(c: RememberedCompany) {
  await tokenStorage.set(KEY, JSON.stringify(c));
}

export async function rememberedCompany(): Promise<RememberedCompany | null> {
  try {
    const raw = await tokenStorage.get(KEY);
    return raw ? (JSON.parse(raw) as RememberedCompany) : null;
  } catch {
    return null;
  }
}

export async function forgetCompany() {
  await tokenStorage.remove(KEY);
}

/** Public URL of the company's personal sign-in page. */
export function companyLoginUrl(code: string) {
  const origin =
    Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : API_URL.replace(/\/api\/v1\/?$/, '');
  return `${origin}/c/${encodeURIComponent(code)}`;
}
