import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { api, errorMessage } from '@/api/client';
import { AuthCard, AuthField, AuthShell, authStyles, Notice } from '@/components/AuthShell';
import { Button } from '@/components/ui';

/** "I forgot my company's login link" — re-sent to the account's official e-mail. */
export default function LoginLinkScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <AuthShell>
      <AuthCard title="أرسل لي رابط الدخول" subtitle="أدخل بريدك الرسمي المسجل في المنصة وسنرسل إليه رابط الدخول الخاص بشركتك">
        {sent ? (
          <Notice tone="success" text={`إذا كان البريد ${email.trim()} مسجلاً لحساب نشط فستصله رسالة خلال دقائق تحتوي رابط الدخول الخاص بشركتك. تحقق من مجلد Spam أيضاً.`} />
        ) : (
          <>
            <AuthField label="البريد الإلكتروني" icon="✉️" value={email} onChangeText={setEmail} autoCapitalize="none"
              keyboardType="email-address" placeholder="name@company.sa" />
            {error ? <Notice text={`⚠️ ${error}`} /> : null}
            <Button title="إرسال الرابط" loading={busy} disabled={!valid}
              onPress={async () => {
                setBusy(true);
                setError(null);
                try {
                  await api('/auth/login-link', { method: 'POST', body: { email: email.trim() } });
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
