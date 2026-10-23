import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Loading } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { setPendingRedirect } from '@/pendingRedirect';

/**
 * Target of every printed QR code (`<site>/q/<token>`): a phone camera opens the form in the browser
 * (or the installed app). Not signed in yet → sign in first, then the form opens automatically.
 */
export default function QrLanding() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { user, loading, isPlatform } = useAuth();

  useEffect(() => {
    if (loading || !token) return;
    if (!user) {
      setPendingRedirect(`/q/${token}`);
      router.replace('/login');
    } else if (isPlatform) {
      router.replace('/platform');
    } else {
      router.replace({ pathname: '/form', params: { payload: token } });
    }
  }, [loading, user, isPlatform, token]);

  return <Loading />;
}
