import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { api, errorMessage } from '@/api/client';
import { AuthCard, AuthField, AuthShell, authStyles, Notice } from '@/components/AuthShell';
import { Button } from '@/components/ui';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <AuthShell>
      <AuthCard title="استعادة كلمة المرور" subtitle="أدخل بريدك الرسمي وسنرسل إليه رابط تعيين كلمة مرور جديدة إن كان الحساب موجوداً">
        {sent ? (
          <Notice tone="success" text="إذا كانت البيانات صحيحة فستصلك رسالة خلال دقائق تحتوي رابطاً صالحاً لمدة ساعة." />
        ) : (
          <>
            <AuthField label="البريد الإلكتروني" icon="✉️" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            {error ? <Notice text={`⚠️ ${error}`} /> : null}
            <Button title="إرسال الرابط" loading={busy} disabled={!email.trim()}
              onPress={async () => {
                setBusy(true);
                setError(null);
                try {
                  await api('/auth/forgot-password', { method: 'POST', body: { email: email.trim() } });
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
