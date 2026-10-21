import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { I18nManager, Platform } from 'react-native';
import { Loading } from '@/components/ui';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { flushOutbox } from '@/offline';
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
  const { user, loading } = useAuth();
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
      <Stack.Protected guard={!user}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!!user}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="form" options={{ title: 'نموذج رقمي' }} />
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
    </AuthProvider>
  );
}
