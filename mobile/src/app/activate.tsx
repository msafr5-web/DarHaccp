import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import { AuthCard, AuthField, AuthShell, authStyles, Notice } from '@/components/AuthShell';
import { Button, styles } from '@/components/ui';
import { companyLoginUrl } from '@/companyLink';

const rules = [
  { test: (p: string) => p.length >= 10, label: '10 أحرف على الأقل' },
  { test: (p: string) => /[A-Z]/.test(p), label: 'حرف كبير (A-Z)' },
  { test: (p: string) => /[a-z]/.test(p), label: 'حرف صغير (a-z)' },
  { test: (p: string) => /\d/.test(p), label: 'رقم' },
];

/** Opened from the approval or password-reset e-mail: sets the account password. */
export default function ActivateScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [result, setResult] = useState<{ companyCode: string; email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const strong = rules.every((r) => r.test(password));

  if (!token) {
    return (
      <AuthShell>
        <AuthCard title="رابط غير صالح">
          <Notice text="افتح الرابط كما وصلك في البريد الإلكتروني." />
          <Button title="تسجيل الدخول" onPress={() => router.replace('/login')} />
        </AuthCard>
      </AuthShell>
    );
  }

  if (result) {
    return (
      <AuthShell>
        <AuthCard title="✅ تم تعيين كلمة المرور" subtitle="يمكنك الآن تسجيل الدخول — سيصلك رمز تحقق على بريدك عند كل دخول">
          <View style={authStyles.codeBox}>
            <Text style={styles.muted}>رابط الدخول الخاص بشركتك — احفظه في المفضلة</Text>
            <Text style={[styles.body, { fontWeight: '800', color: '#0B5D3B', writingDirection: 'ltr' }]} selectable>
              {companyLoginUrl(result.companyCode)}
            </Text>
            <Text style={[styles.hint, { textAlign: 'center' }]}>وصلك الرابط أيضاً على بريدك، ويمكن إعادة إرساله في أي وقت</Text>
          </View>
          <Button title="تسجيل الدخول" onPress={() => router.replace({ pathname: '/c/[code]', params: { code: result.companyCode, email: result.email } })} />
        </AuthCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthCard title="تعيين كلمة المرور" subtitle="اختر كلمة مرور قوية لحسابك">
        <AuthField label="كلمة المرور الجديدة" icon="🔒" value={password} onChangeText={setPassword} secureTextEntry />
        <View style={{ marginTop: -6, marginBottom: 12 }}>
          {rules.map((r) => (
            <Text key={r.label} style={[styles.hint, { color: r.test(password) ? '#067647' : '#667085' }]}>
              {r.test(password) ? '✓' : '○'} {r.label}
            </Text>
          ))}
        </View>
        <AuthField label="تأكيد كلمة المرور" icon="🔒" value={confirm} onChangeText={setConfirm} secureTextEntry
          hint={confirm && confirm !== password ? 'كلمتا المرور غير متطابقتين' : undefined} />
        {error ? <Notice text={`⚠️ ${error}`} /> : null}
        <Button title="حفظ كلمة المرور" loading={busy} disabled={!strong || confirm !== password}
          onPress={async () => {
            setBusy(true);
            setError(null);
            try {
              setResult(await api('/auth/activate', { method: 'POST', body: { token, password } }));
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }} />
      </AuthCard>
    </AuthShell>
  );
}
