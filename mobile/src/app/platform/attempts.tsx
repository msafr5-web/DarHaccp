import { Stack, useLocalSearchParams } from 'expo-router';
import { AttemptsList } from '@/components/AttemptsList';

export default function PlatformAttemptsScreen() {
  const { tenantId, name } = useLocalSearchParams<{ tenantId?: string; name?: string }>();
  return (
    <>
      <Stack.Screen options={{ title: name ? `محاولات الدخول — ${name}` : 'محاولات الدخول — كل الشركات' }} />
      <AttemptsList path={`/platform/login-attempts${tenantId ? `?tenantId=${tenantId}` : ''}`} showCompany={!tenantId} />
    </>
  );
}
