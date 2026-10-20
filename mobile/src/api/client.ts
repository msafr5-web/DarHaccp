import Constants from 'expo-constants';

/** API base URL: EXPO_PUBLIC_API_URL (build-time env) or app.json `extra.apiUrl`. */
export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'http://localhost:4000/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

/** Called when the server rejects the session (expired / revoked token). */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'تعذر الاتصال بالخادم. تحقق من الشبكة.');
  }

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    if (res.status === 401 && authToken) onUnauthorized?.();
    const err = json?.error ?? {};
    throw new ApiError(res.status, err.code ?? 'UNKNOWN', err.message ?? `Request failed (${res.status})`, err.details);
  }
  return json.data as T;
}

/** Human-readable message (Arabic first) for an error thrown by `api()`. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.details?.length) return e.details.map((d) => d.message).join('\n');
    const ar: Record<string, string> = {
      INVALID_CREDENTIALS: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
      ACCOUNT_LOCKED: 'تم قفل الحساب مؤقتاً بسبب محاولات دخول فاشلة',
      FORBIDDEN: 'ليست لديك صلاحية لهذا الإجراء',
      TOO_MANY_REQUESTS: 'طلبات كثيرة، حاول لاحقاً',
      EQUIPMENT_OUT_OF_SERVICE: 'الجهاز خارج الخدمة — لا تستخدمه',
      FORM_RETIRED: 'هذا النموذج ملغى، استخدم الملصق الجديد',
    };
    return ar[e.code] ?? e.message;
  }
  return 'حدث خطأ غير متوقع';
}
