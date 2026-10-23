import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { errorMessage } from '@/api/client';
import { AuthCard, AuthField, AuthShell, authStyles, Notice, useServerHealth } from '@/components/AuthShell';
import { InstallPrompt } from '@/components/InstallPrompt';
import { Button, styles } from '@/components/ui';
import { LoginChallenge, useAuth } from '@/context/AuthContext';
import { colors } from '@/theme';

const DEMO_CODE = 'DarAl0000020102026';
const DEMO_ACCOUNTS = [
  { label: 'مدير الشركة', email: 'admin@daraldhiafa.sa' },
  { label: 'مسؤول الهاسب', email: 'haccp@daraldhiafa.sa' },
  { label: 'مشرف البارد', email: 'cold.supervisor@daraldhiafa.sa' },
  { label: 'شيف البارد', email: 'cold.chef@daraldhiafa.sa' },
];

/** Two-step sign-in: company code + e-mail + password, then the 6-digit code e-mailed on every login. */
export default function LoginScreen() {
  const params = useLocalSearchParams<{ code?: string; email?: string }>();
  const { startLogin, verifyOtp, resendOtp, lastCompanyCode } = useAuth();
  const [server, recheck] = useServerHealth();
  const [companyCode, setCompanyCode] = useState(params.code ?? '');
  const [email, setEmail] = useState(params.email ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [challenge, setChallenge] = useState<LoginChallenge | null>(null);
  const [otp, setOtp] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!params.code) lastCompanyCode().then((c) => c && setCompanyCode((v) => v || c));
  }, [params.code, lastCompanyCode]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
      void recheck();
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = () =>
    run(async () => {
      const c = await startLogin(companyCode, email, password);
      setChallenge(c);
      setOtp('');
      setCooldown(60);
    });

  const submitOtp = () => run(async () => verifyOtp(challenge!.challengeId, otp));

  const banner =
    server === 'unreachable' ? 'الخادم غير متاح حالياً — لا يمكن تسجيل الدخول.' : server === 'degraded' ? 'قاعدة البيانات غير متاحة حالياً.' : null;

  return (
    <AuthShell server={server} showFeatures>
      {!challenge ? (
        <AuthCard title="تسجيل الدخول" subtitle="أدخل رمز شركتك وبيانات حسابك — سيصلك رمز تحقق على بريدك">
          {banner ? <Notice text={`🔌 ${banner}`} /> : null}
          <AuthField label="رمز الشركة" icon="🏢" value={companyCode} onChangeText={setCompanyCode} autoCapitalize="none"
            autoCorrect={false} placeholder="مثال: RuknH7768723102026" />
          <AuthField label="البريد الإلكتروني" icon="✉️" value={email} onChangeText={setEmail} autoCapitalize="none"
            autoComplete="email" keyboardType="email-address" placeholder="name@company.sa" />
          <AuthField label="كلمة المرور" icon="🔒" value={password} onChangeText={setPassword} secureTextEntry={!showPassword}
            autoComplete="password" placeholder="••••••••" onSubmitEditing={submitPassword}
            right={<Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10}>
              <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>{showPassword ? 'إخفاء' : 'إظهار'}</Text>
            </Pressable>} />
          {error ? <Notice text={`⚠️ ${error}`} /> : null}
          <Button title="متابعة" onPress={submitPassword} loading={busy} disabled={!companyCode.trim() || !email || !password} />
          <View style={[styles.row, { justifyContent: 'space-between', marginTop: 4 }]}>
            <Pressable onPress={() => router.push('/forgot')}><Text style={authStyles.link}>نسيت كلمة المرور؟</Text></Pressable>
            <Pressable onPress={() => router.push('/register')}><Text style={authStyles.link}>تسجيل شركة جديدة ←</Text></Pressable>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, marginBottom: 10 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: '#EAECF0' }} />
            <Text style={{ color: colors.muted, fontSize: 12 }}>حسابات الشركة التجريبية</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: '#EAECF0' }} />
          </View>
          <View style={[styles.row, { flexWrap: 'wrap', gap: 8 }]}>
            {DEMO_ACCOUNTS.map((a) => (
              <Pressable key={a.email} onPress={() => { setCompanyCode(DEMO_CODE); setEmail(a.email); setError(null); }}
                style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1,
                  borderColor: email === a.email ? colors.primary : colors.border, backgroundColor: email === a.email ? colors.primaryLight : '#fff' }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: email === a.email ? colors.primary : colors.text }}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        </AuthCard>
      ) : (
        <AuthCard title="رمز التحقق" subtitle={`أرسلنا رمزاً من 6 أرقام إلى ${challenge.email} — صالح 5 دقائق`}>
          <AuthField label="الرمز" icon="🔑" value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6}
            placeholder="••••••" onSubmitEditing={() => otp.length === 6 && submitOtp()} style={authStyles.otp} />
          {error ? <Notice text={`⚠️ ${error}`} /> : null}
          {info ? <Notice text={info} tone="success" /> : null}
          <Button title="تأكيد الدخول" onPress={submitOtp} loading={busy} disabled={otp.length !== 6} />
          <Button
            title={cooldown > 0 ? `إعادة إرسال الرمز (${cooldown})` : 'إعادة إرسال الرمز'}
            variant="outline"
            disabled={cooldown > 0 || busy}
            onPress={() => run(async () => {
              const r = await resendOtp(challenge.challengeId);
              setCooldown(60);
              setInfo(`تم إرسال رمز جديد إلى ${r.email}`);
            })}
          />
          <Pressable onPress={() => { setChallenge(null); setError(null); setOtp(''); }}>
            <Text style={authStyles.link}>→ العودة وتغيير البيانات</Text>
          </Pressable>
        </AuthCard>
      )}
      <InstallPrompt />
    </AuthShell>
  );
}
