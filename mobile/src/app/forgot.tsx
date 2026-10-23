import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { api, errorMessage } from '@/api/client';
import { AuthCard, AuthField, AuthShell, authStyles, Notice } from '@/components/AuthShell';
import { Button } from '@/components/ui';

export default function ForgotPasswordScreen() {
  const [companyCode, setCompanyCode] = useState('');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <AuthShell>
      <AuthCard title="استعادة كلمة المرور" subtitle="أدخل رمز الشركة وبريدك، وسنرسل رابط تعيين كلمة مرور جديدة إن كان الحساب موجوداً">
        {sent ? (
          <Notice tone="success" text="إذا كانت البيانات صحيحة فستصلك رسالة خلال دقائق تحتوي رابطاً صالحاً لمدة ساعة." />
        ) : (
          <>
            <AuthField label="رمز الشركة" icon="🏢" value={companyCode} onChangeText={setCompanyCode} autoCapitalize="none" />
            <AuthField label="البريد الإلكتروني" icon="✉️" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            {error ? <Notice text={`⚠️ ${error}`} /> : null}
            <Button title="إرسال الرابط" loading={busy} disabled={!companyCode.trim() || !email.trim()}
              onPress={async () => {
                setBusy(true);
                setError(null);
                try {
                  await api('/auth/forgot-password', { method: 'POST', body: { companyCode: companyCode.trim(), email: email.trim() } });
                  setSent(true);
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }} />
          </>
        )}
        <Pressable onPress={() => router.replace('/login')}><Text style={authStyles.link}>→ العودة لتسجيل الدخول</Text></Pressable>
      </AuthCard>
    </AuthShell>
  );
}
