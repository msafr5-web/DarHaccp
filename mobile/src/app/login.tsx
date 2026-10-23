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
 * Password-less sign-in: type the official e-mail → one message arrives with a one-click
 * login link AND a 6-digit code. Click the link, or type the code here.
 * When opened from the company's link (/c/<code>), the page is branded with the company name.
 */
export default function LoginScreen() {
  const params = useLocalSearchParams<{ code?: string; email?: string }>();
  const { startLogin, verifyOtp, resendOtp } = useAuth();
  const [server, recheck] = useServerHealth();
  const [company, setCompany] = useState<RememberedCompany | null>(null);
  const [email, setEmail] = useState(params.email ?? '');
  const [challenge, setChallenge] = useState<LoginChallenge | null>(null);
  const [otp, setOtp] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

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

  const sendLink = () =>
    run(async () => {
      if (!emailOk) return;
      setChallenge(await startLogin(email, company?.code));
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
          subtitle="أدخل بريدك الرسمي — سيصلك فوراً رابط الدخول ورمز التحقق، بدون كلمة مرور"
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
            autoComplete="email" keyboardType="email-address" placeholder="name@company.sa" onSubmitEditing={sendLink}
            returnKeyType="send" />
          {error ? <Notice text={`⚠️ ${error}`} /> : null}
          <Button title="إرسال رابط ورمز الدخول" onPress={sendLink} loading={busy} disabled={!emailOk} />
          <View style={{ height: 1, backgroundColor: '#EAECF0', marginVertical: 12 }} />
          <Pressable onPress={() => router.push('/register')}>
            <Text style={[authStyles.link, { textAlign: 'center' }]}>شركة جديدة؟ سجّل اشتراكك الآن ←</Text>
          </Pressable>
        </AuthCard>
      ) : (
        <AuthCard title="📬 تحقق من بريدك" subtitle={`إذا كان ${challenge.email} مسجلاً لدينا فقد أرسلنا إليه رسالة الدخول`}>
          <Notice tone="info" text="اضغط زر «الدخول الآن» في الرسالة للدخول مباشرة، أو اكتب رمز التحقق المكوّن من 6 أرقام هنا. الرابط والرمز صالحان 5 دقائق ولمرة واحدة." />
          <AuthField label="رمز التحقق" icon="🔑" value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6}
            placeholder="••••••" onSubmitEditing={() => otp.length === 6 && submitOtp()} style={authStyles.otp} />
          {error ? <Notice text={`⚠️ ${error}`} /> : null}
          {info ? <Notice text={info} tone="success" /> : null}
          <Button title="تأكيد الدخول" onPress={submitOtp} loading={busy} disabled={otp.length !== 6} />
          <Button
            title={cooldown > 0 ? `إعادة الإرسال (${cooldown})` : 'إعادة إرسال الرسالة'}
            variant="outline"
            disabled={cooldown > 0 || busy}
            onPress={() => run(async () => {
              const r = await resendOtp(challenge.challengeId);
              setCooldown(60);
              setInfo(`تم إرسال رسالة جديدة إلى ${r.email}`);
            })}
          />
          <Text style={[styles.hint, { textAlign: 'center' }]}>لم تصل الرسالة؟ تحقق من مجلد Spam / الرسائل غير المرغوبة</Text>
          <Pressable onPress={() => { setChallenge(null); setError(null); setOtp(''); }}>
            <Text style={authStyles.link}>→ تغيير البريد</Text>
          </Pressable>
        </AuthCard>
      )}
      <InstallPrompt />
    </AuthShell>
  );
}
