import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import { AuthCard, AuthField, AuthShell, authStyles, Notice } from '@/components/AuthShell';
import { Button, styles } from '@/components/ui';
import { isSaudiMobile, previewCompanyCode } from '@/companyCode';
import { colors, textStart } from '@/theme';

interface Registration {
  id: number;
  accountNo: string;
  code: string;
  status: string;
  challengeId: string;
  email: string;
}

/**
 * Company self-registration (SaaS sign-up):
 * details → e-mail confirmation code → application queued for platform review.
 */
export default function RegisterScreen() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [otp, setOtp] = useState('');
  const [done, setDone] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const code = previewCompanyCode(name, phone);
  const phoneOk = isSaudiMobile(phone);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const valid = name.trim().length >= 2 && phoneOk && emailOk && address.trim().length >= 5;

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (done && registration) {
    return (
      <AuthShell>
        <AuthCard title="✅ تم استلام طلب الاشتراك" subtitle="تم تأكيد بريد الشركة، والطلب الآن قيد مراجعة إدارة منصة DarHaccp">
          <View style={authStyles.codeBox}>
            <Text style={styles.muted}>رمز الشركة</Text>
            <Text style={authStyles.codeText} selectable>{registration.code}</Text>
            <Text style={[styles.muted, { marginTop: 6 }]}>الرقم التعريفي: {registration.accountNo}</Text>
          </View>
          <Notice tone="info" text="احتفظ برمز الشركة — يُطلب عند كل تسجيل دخول. ستصلك رسالة على البريد عند الموافقة تتضمن رابط تفعيل حساب مدير الشركة." />
          <Button title="العودة لتسجيل الدخول" onPress={() => router.replace({ pathname: '/login', params: { code: registration.code } })} />
        </AuthCard>
      </AuthShell>
    );
  }

  if (registration) {
    return (
      <AuthShell>
        <AuthCard title="تأكيد بريد الشركة" subtitle={`أرسلنا رمزاً من 6 أرقام إلى ${registration.email}`}>
          <AuthField label="رمز التأكيد" icon="🔑" value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad" maxLength={6} placeholder="••••••" style={authStyles.otp} />
          {error ? <Notice text={`⚠️ ${error}`} /> : null}
          <Button title="تأكيد" loading={busy} disabled={otp.length !== 6}
            onPress={() => run(async () => {
              await api('/public/register/verify', { method: 'POST', body: { challengeId: registration.challengeId, code: otp } });
              setDone(true);
            })} />
          <Button title={cooldown > 0 ? `إعادة الإرسال (${cooldown})` : 'إعادة إرسال الرمز'} variant="outline" disabled={cooldown > 0 || busy}
            onPress={() => run(async () => {
              await api('/public/register/resend', { method: 'POST', body: { challengeId: registration.challengeId } });
              setCooldown(60);
            })} />
        </AuthCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthCard title="تسجيل شركة جديدة" subtitle="أنشئ حساباً مستقلاً لشركتك — يُراجع الطلب من إدارة المنصة قبل التفعيل">
        <AuthField label="اسم الشركة *" icon="🏢" value={name} onChangeText={setName} placeholder="مثال: RuknHacpp" />
        <AuthField label="رقم جوال التواصل *" icon="📱" value={phone} onChangeText={setPhone} keyboardType="phone-pad"
          placeholder="05XXXXXXXX" hint={phone && !phoneOk ? 'أدخل رقم جوال سعودي صحيح (05XXXXXXXX)' : undefined} />
        <AuthField label="البريد الإلكتروني *" icon="✉️" value={email} onChangeText={setEmail} autoCapitalize="none"
          keyboardType="email-address" placeholder="info@company.sa" hint="يُرسل إليه رمز التحقق عند كل تسجيل دخول لمدير الشركة" />
        <AuthField label="العنوان *" icon="📍" value={address} onChangeText={setAddress} placeholder="المدينة، الحي، الشارع" multiline />

        <View style={[authStyles.codeBox, !code && { opacity: 0.5 }]}>
          <Text style={styles.muted}>رمز شركتك سيكون</Text>
          <Text style={authStyles.codeText} selectable>{code ?? '—'}</Text>
          <Text style={[styles.hint, { textAlign: 'center' }]}>
            5 أحرف من اسم الشركة + آخر 5 أرقام من الجوال + تاريخ الاشتراك (يوم شهر سنة)
          </Text>
        </View>

        {error ? <Notice text={`⚠️ ${error}`} /> : null}
        <Button title="إرسال طلب الاشتراك" loading={busy} disabled={!valid}
          onPress={() => run(async () => {
            const r = await api<Registration>('/public/register', {
              method: 'POST',
              body: { name: name.trim(), phone: phone.trim(), email: email.trim(), address: address.trim() },
            });
            setRegistration(r);
            setCooldown(60);
          })} />
        <Pressable onPress={() => router.replace('/login')}>
          <Text style={[authStyles.link, { textAlign: 'center' }]}>لديك حساب؟ تسجيل الدخول</Text>
        </Pressable>
        <Text style={[styles.hint, { textAlign: textStart, color: colors.muted }]}>
          بالتسجيل توافق على معالجة بيانات شركتك لأغراض تشغيل المنصة.
        </Text>
      </AuthCard>
    </AuthShell>
  );
}
