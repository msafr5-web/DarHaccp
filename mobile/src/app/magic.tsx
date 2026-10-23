import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/api/client';
import { AuthCard, AuthShell, Notice } from '@/components/AuthShell';
import { Button, Loading } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';

/** Target of the one-click login link in the sign-in e-mail (/magic?c=<challenge>&t=<token>). */
export default function MagicLinkScreen() {
  const { c, t } = useLocalSearchParams<{ c?: string; t?: string }>();
  const { user, verifyMagicLink } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (user) {
      router.replace('/');
      return;
    }
    if (started.current) return;
    started.current = true;
    if (!c || !t) {
      setError('الرابط غير مكتمل — افتحه كما وصلك في البريد');
      return;
    }
    // On success the root navigator moves the signed-in user to the right home screen.
    verifyMagicLink(c, t).catch((e) => setError(errorMessage(e)));
  }, [c, t, user, verifyMagicLink]);

  if (!error) return <Loading />;
  return (
    <AuthShell>
      <AuthCard title="تعذر الدخول بالرابط" subtitle="روابط الدخول صالحة 5 دقائق ولمرة واحدة فقط">
        <Notice text={`⚠️ ${error}`} />
        <Button title="اطلب رابطاً جديداً" onPress={() => router.replace('/login')} />
      </AuthCard>
    </AuthShell>
  );
}
