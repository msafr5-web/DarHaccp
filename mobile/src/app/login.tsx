import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { errorMessage } from '@/api/client';
import { AuthCard, AuthField, AuthShell, authStyles, Notice, useServerHealth } from '@/components/AuthShell';
import { InstallPrompt } from '@/components/InstallPrompt';
import { Button, styles } from '@/components/ui';
import { forgetCompany, RememberedCompany, rememberedCompany } from '@/companyLink';
import { LoginChallenge, useAuth } from '@/context/AuthContext';
import { colors } from '@/theme';

/**
 * Sign-in: official e-mail + password, then the 6-digit code e-mailed on every login.
 * No company code to remember — the e-mail is unique on the platform. When opened from the
 * company's personal login link (/c/<code>), the page is branded with the company name.
 */
export default function LoginScreen() {
  const params = useLocalSearchParams<{ code?: string; email?: string }>();
  const { startLogin, verifyOtp, resendOtp } = useAuth();
  const [server, recheck] = useServerHealth();
  const [company, setCompany] = useState<RememberedCompany | null>(null);
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
    rememberedCompany().then((c) => {
      if (c && (!params.code || c.code.toLowerCase() === params.code.toLowerCase())) setCompany(c);
    });
  }, [params.code]);

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
      const c = await startLogin(email, password, company?.code);
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
        <AuthCard
          title={company ? `الدخول إلى ${company.name}` : 'تسجيل الدخول'}
          subtitle="أدخل بريدك الرسمي وكلمة المرور — سيصلك رمز تحقق على بريدك"
        >
          {banner ? <Notice text={`🔌 ${banner}`} /> : null}
          {company ? (
            <View style={[styles.row, { justifyContent: 'space-between', backgroundColor: colors.primaryLight, borderRadius: 12, padding: 12, marginBottom: 14 }]}>
              <Text style={[styles.body, { fontWeight: '700', flex: 1 }]}>🏢 {company.name}</Text>
              <Pressable onPress={() => { void forgetCompany(); setCompany(null); router.setParams({ code: undefined }); }}>
                <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600' }}>ليست شركتي</Text>
              </Pressable>
            </View>
          ) : null}
          <AuthField label="البريد الإلكتروني الرسمي" icon="✉️" value={email} onChangeText={setEmail} autoCapitalize="none"
            autoComplete="email" keyboardType="email-address" placeholder="name@company.sa" />
          <AuthField label="كلمة المرور" icon="🔒" value={password} onChangeText={setPassword} secureTextEntry={!showPassword}
            autoComplete="password" placeholder="••••••••" onSubmitEditing={submitPassword}
            right={<Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10}>
              <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>{showPassword ? 'إخفاء' : 'إظهار'}</Text>
            </Pressable>} />
          {error ? <Notice text={`⚠️ ${error}`} /> : null}
          <Button title="متابعة" onPress={submitPassword} loading={busy} disabled={!email.trim() || !password} />
          <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap', marginTop: 4 }]}>
            <Pressable onPress={() => router.push('/forgot')}><Text style={authStyles.link}>نسيت كلمة المرور؟</Text></Pressable>
            <Pressable onPress={() => router.push('/login-link')}><Text style={authStyles.link}>أرسل لي رابط الدخول</Text></Pressable>
          </View>
          <View style={{ height: 1, backgroundColor: '#EAECF0', marginVertical: 10 }} />
          <Pressable onPress={() => router.push('/register')}>
            <Text style={[authStyles.link, { textAlign: 'center' }]}>شركة جديدة؟ سجّل اشتراكك الآن ←</Text>
          </Pressable>
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
          <Text style={[styles.hint, { textAlign: 'center' }]}>لم يصل الرمز؟ تحقق من مجلد Spam / الرسائل غير المرغوبة</Text>
          <Pressable onPress={() => { setChallenge(null); setError(null); setOtp(''); }}>
            <Text style={authStyles.link}>→ العودة وتغيير البيانات</Text>
          </Pressable>
        </AuthCard>
      )}
      <InstallPrompt />
    </AuthShell>
  );
}
