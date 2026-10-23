import { router, Stack, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { I18nManager, Platform } from 'react-native';
import { AlertAlarm } from '@/components/AlertAlarm';
import { Loading } from '@/components/ui';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { flushOutbox } from '@/offline';
import { takePendingRedirect } from '@/pendingRedirect';
import { colors } from '@/theme';

// Arabic-first UI: right-to-left layout (applies after the first app restart).
I18nManager.allowRTL(true);
I18nManager.forceRTL(true);
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.documentElement.dir = 'rtl';
  document.documentElement.lang = 'ar';
}

/** Replays offline submissions: on sign-in, every 30 s, and when the browser reports it is back online. */
function OutboxSync() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    const flush = () => void flushOutbox();
    flush();
    const timer = setInterval(flush, 30_000);
    const online = Platform.OS === 'web' && typeof window !== 'undefined';
    if (online) window.addEventListener('online', flush);
    return () => {
      clearInterval(timer);
      if (online) window.removeEventListener('online', flush);
    };
  }, [user]);
  return null;
}

function RootNavigator() {
  const { user, loading, isPlatform } = useAuth();
  const segments = useSegments();

  // Platform administrators live in the platform console; company users never see it.
  useEffect(() => {
    if (loading || !user) return;
    const inPlatform = segments[0] === 'platform';
    // A QR code scanned before signing in: open its form now.
    const pending = !isPlatform ? takePendingRedirect() : null;
    if (pending && segments[0] !== 'q') {
      router.replace(pending as never);
      return;
    }
    if (isPlatform && !inPlatform) router.replace('/platform');
    else if (!isPlatform && inPlatform) router.replace('/');
  }, [loading, user, isPlatform, segments]);

  if (loading) return <Loading />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      {/* Public: sign-in, company registration, activation & password reset links from e-mails. */}
      <Stack.Protected guard={!user}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Screen name="register" options={{ headerShown: false }} />
      <Stack.Screen name="activate" options={{ headerShown: false }} />
      <Stack.Screen name="forgot" options={{ headerShown: false }} />
      <Stack.Screen name="login-link" options={{ headerShown: false }} />
      <Stack.Screen name="c/[code]" options={{ headerShown: false }} />
      <Stack.Screen name="magic" options={{ headerShown: false }} />
      <Stack.Screen name="q/[token]" options={{ title: 'فتح النموذج' }} />

      <Stack.Protected guard={!!user && isPlatform}>
        <Stack.Screen name="platform/index" options={{ title: 'إدارة المنصة' }} />
        <Stack.Screen name="platform/[id]" options={{ title: 'مراجعة الشركة' }} />
        <Stack.Screen name="platform/attempts" options={{ title: 'محاولات الدخول' }} />
        <Stack.Screen name="platform/forms/index" options={{ title: 'مكتبة النماذج' }} />
        <Stack.Screen name="platform/forms/[id]" options={{ title: 'تحرير النموذج' }} />
        <Stack.Screen name="platform/tenant-form" options={{ title: 'نموذج الشركة' }} />
      </Stack.Protected>

      <Stack.Protected guard={!!user && !isPlatform}>
        <Stack.Screen name="security" options={{ title: 'سجل محاولات الدخول' }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="form" options={{ title: 'نموذج رقمي' }} />
        <Stack.Screen name="records/index" options={{ title: 'سجلات النماذج' }} />
        <Stack.Screen name="records/[id]" options={{ title: 'السجل' }} />
        <Stack.Screen name="users/index" options={{ title: 'الموظفون والصلاحيات' }} />
        <Stack.Screen name="equipment/index" options={{ title: 'الأجهزة ومسجلات البيانات' }} />
        <Stack.Screen name="equipment/[id]" options={{ title: 'الجهاز' }} />
        <Stack.Screen name="items/index" options={{ title: 'جدول الأصناف الرئيسي' }} />
        <Stack.Screen name="stock/index" options={{ title: 'المخزون والصلاحية (FEFO)' }} />
        <Stack.Screen name="trace/index" options={{ title: 'تتبع التشغيلة (Recall)' }} />
        <Stack.Screen name="health-register/index" options={{ title: 'سجل الشهادات الصحية (بلدي)' }} />
        <Stack.Screen name="template-options/[id]" options={{ title: 'القوائم المعتمدة' }} />
        <Stack.Screen name="capa/[id]" options={{ title: 'إجراء تصحيحي (CAPA)' }} />
        <Stack.Screen name="incidents/index" options={{ title: 'الحوادث وعدم المطابقة' }} />
        <Stack.Screen name="incidents/new" options={{ title: 'بلاغ جديد' }} />
        <Stack.Screen name="incidents/[id]" options={{ title: 'تفاصيل البلاغ' }} />
        <Stack.Screen name="audits/index" options={{ title: 'التدقيق الداخلي' }} />
        <Stack.Screen name="audits/[id]" options={{ title: 'قائمة التدقيق' }} />
        <Stack.Screen name="labels/index" options={{ title: 'بطاقات البيانات' }} />
        <Stack.Screen name="labels/new" options={{ title: 'إصدار بطاقة بيانات' }} />
        <Stack.Screen name="labels/[id]" options={{ title: 'بطاقة المنتج' }} />
        <Stack.Screen name="staff/index" options={{ title: 'العاملون والشهادات الصحية' }} />
        <Stack.Screen name="contractors/index" options={{ title: 'المقاولون' }} />
        <Stack.Screen name="documents/index" options={{ title: 'الوثائق المعتمدة' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <OutboxSync />
      <RootNavigator />
      <AlertAlarm />
    </AuthProvider>
  );
}
