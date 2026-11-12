import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { errorMessage } from '@/api/client';
import { AuthCard, AuthField, AuthShell, authStyles, Notice, useServerHealth } from '@/components/AuthShell';
import { InstallPrompt } from '@/components/InstallPrompt';
import { Button, styles } from '@/components/ui';
import { LoginChallenge, useAuth } from '@/context/AuthContext';
import { colors } from '@/theme';

/**
 * Management sign-in (/admin): for platform administrators only. Same password-less flow as everywhere
 * (e-mail → one message with a login link and a 6-digit code), but the server only serves administrators,
 * and answers every other e-mail in exactly the same way — so nothing about other accounts is revealed.
 */
export default function AdminLoginScreen() {
  const { user, isPlatform, startLogin, verifyOtp, resendOtp } = useAuth();
  const [server, recheck] = useServerHealth();
  const [email, setEmail] = useState('');
  const [challenge, setChallenge] = useState<LoginChallenge | null>(null);
  const [otp, setOtp] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  // Already signed in: administrators go to the console, company users to their own home.
  useEffect(() => {
    if (user) router.replace(isPlatform ? '/platform' : '/');
  }, [user, isPlatform]);

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
      setChallenge(await startLogin(email, undefined, 'PLATFORM'));
      setOtp('');
      setCooldown(60);
    });
  const submitOtp = () => run(async () => verifyOtp(challenge!.challengeId, otp));

  const banner =
    server === 'unreachable' ? 'الخادم غير متاح حالياً — لا يمكن تسجيل الدخول.' : server === 'degraded' ? 'قاعدة البيانات غير متاحة حالياً.' : null;

  return (
    <AuthShell server={server}>
      {!challenge ? (
        <AuthCard title="👑 دخول إدارة المنصة" subtitle="هذه الصفحة لمديري المنصة فقط — أدخل بريدك الإداري وسيصلك رابط الدخول ورمز التحقق">
          {banner ? <Notice text={`🔌 ${banner}`} /> : null}
          <AuthField label="البريد الإلكتروني الإداري" icon="✉️" value={email} onChangeText={setEmail} autoCapitalize="none"
            autoComplete="email" keyboardType="email-address" placeholder="name@company.com" onSubmitEditing={sendLink} returnKeyType="send" />
          {error ? <Notice text={`⚠️ ${error}`} /> : null}
          <Button title="إرسال رابط ورمز الدخول" onPress={sendLink} loading={busy} disabled={!emailOk} />
          <View style={{ height: 1, backgroundColor: '#EAECF0', marginVertical: 12 }} />
          <View style={{ backgroundColor: colors.warningLight, borderRadius: 10, padding: 10 }}>
            <Text style={{ color: colors.warning, fontSize: 12, textAlign: 'center' }}>
              كل محاولة دخول إلى هذه الصفحة تُسجَّل. إن لم تكن مدير منصة فاستخدم صفحة دخول الشركات.
            </Text>
          </View>
          <Pressable onPress={() => router.push('/login')}>
            <Text style={[authStyles.link, { textAlign: 'center', marginTop: 12 }]}>دخول الشركات والموظفين ←</Text>
          </Pressable>
        </AuthCard>
      ) : (
        <AuthCard title="📬 تحقق من بريدك" subtitle={`إذا كان ${challenge.email} مدير منصة فقد أرسلنا إليه رسالة الدخول`}>
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
