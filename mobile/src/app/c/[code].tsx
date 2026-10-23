import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/api/client';
import { AuthCard, AuthShell, Notice } from '@/components/AuthShell';
import { Button, Loading } from '@/components/ui';
import { rememberCompany } from '@/companyLink';

/**
 * Company login link (/c/<company code>) e-mailed to the company administrator on approval:
 * remembers the company on this device and opens its branded sign-in page.
 */
export default function CompanyLinkScreen() {
  const { code, email } = useLocalSearchParams<{ code: string; email?: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const company = await api<{ name: string; code: string }>(`/public/company/${encodeURIComponent(code)}`);
        await rememberCompany(company);
        router.replace({ pathname: '/login', params: { code: company.code, ...(email ? { email } : {}) } });
      } catch (e) {
        setError(errorMessage(e));
      }
    })();
  }, [code, email]);

  if (!error) return <Loading />;
  return (
    <AuthShell>
      <AuthCard title="رابط الدخول غير صالح" subtitle="قد تكون الشركة غير مفعّلة بعد أو أن الرابط غير مكتمل">
        <Notice text={`⚠️ ${error}`} />
        <Button title="الذهاب إلى صفحة الدخول" onPress={() => router.replace('/login')} />
        <Button title="أرسل لي رابط الدخول على بريدي" variant="outline" onPress={() => router.replace('/login-link')} />
      </AuthCard>
    </AuthShell>
  );
}
