import { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { checkServerHealth, errorMessage } from '@/api/client';
import { InstallPrompt } from '@/components/InstallPrompt';
import { Button } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { colors, textStart } from '@/theme';

const logo = require('../../assets/icon.png');

const FEATURES = [
  { icon: '📷', title: 'مسح QR فوري', text: 'لكل جهاز ومرحلة إنتاج نموذج رقمي يفتح بمسحة واحدة بدل السجلات الورقية' },
  { icon: '🌡️', title: 'نقاط التحكم الحرجة', text: 'تحقق تلقائي من الحدود الحرجة (الطهي ≥ 75°م، التبريد ≤ 4°م) مع تنبيه فوري' },
  { icon: '🛠️', title: 'إجراءات تصحيحية', text: 'فتح CAPA تلقائياً عند أي انحراف ومتابعته حتى التحقق والاعتماد' },
  { icon: '📊', title: 'لوحة امتثال لحظية', text: 'نسب الامتثال، الشهادات الصحية، وحالة صيانة الأجهزة لكل قسم' },
];

const DEPARTMENTS = ['المطبخ الساخن', 'المطبخ البارد', 'الحلويات', 'الخدمات المساندة'];

/** Email-only quick fill for the demo accounts (the password is never embedded in the page). */
const DEMO_ACCOUNTS = [
  { label: 'مدير النظام', email: 'admin@daraldhiafa.sa' },
  { label: 'مسؤول الهاسب', email: 'haccp@daraldhiafa.sa' },
  { label: 'مشرف البارد', email: 'cold.supervisor@daraldhiafa.sa' },
  { label: 'شيف البارد', email: 'cold.chef@daraldhiafa.sa' },
];

function Field({
  label,
  icon,
  right,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string; icon: string; right?: React.ReactNode }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={s.label}>{label}</Text>
      <View style={[s.field, focused && s.fieldFocused]}>
        <Text style={s.fieldIcon}>{icon}</Text>
        <TextInput
          placeholderTextColor="#98A2B3"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[s.input, Platform.OS === 'web' && ({ outlineStyle: 'none' } as object)]}
          {...props}
        />
        {right}
      </View>
    </View>
  );
}

export default function LoginScreen() {
  const { signIn } = useAuth();
  const { width } = useWindowDimensions();
  const wide = width >= 960;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState<'checking' | 'ok' | 'degraded' | 'unreachable'>('checking');

  // Detect a down server / database before the user even tries to sign in.
  useEffect(() => {
    let active = true;
    checkServerHealth().then((s) => active && setServer(s));
    return () => {
      active = false;
    };
  }, []);

  const submit = async () => {
    if (!email || !password || busy) return;
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (e) {
      setError(errorMessage(e));
      checkServerHealth().then(setServer);
    } finally {
      setBusy(false);
    }
  };

  const serverBanner =
    server === 'unreachable'
      ? 'الخادم غير متاح حالياً — لا يمكن تسجيل الدخول. يرجى إبلاغ مسؤول النظام.'
      : server === 'degraded'
        ? 'قاعدة البيانات غير متاحة حالياً — يرجى المحاولة بعد قليل أو إبلاغ مسؤول النظام.'
        : null;

  const brand = (
    <View style={[s.brand, !wide && { alignItems: 'center', marginBottom: 24 }]}>
      <View style={[s.row, !wide && { flexDirection: 'column' }]}>
        <Image source={logo} style={wide ? s.logoLg : s.logo} accessibilityLabel="شعار المنصة" />
        <View style={!wide && { alignItems: 'center', marginTop: 12 }}>
          <Text style={[s.brandTitle, !wide && { fontSize: 28, textAlign: 'center' }]}>دار الضيافة</Text>
          <Text style={[s.brandSubtitle, !wide && { textAlign: 'center' }]}>المنصة الرقمية لسلامة الغذاء والجودة · IMS & HACCP</Text>
        </View>
      </View>

      {wide ? (
        <>
          <View style={s.features}>
            {FEATURES.map((f) => (
              <View key={f.title} style={s.feature}>
                <View style={s.featureIcon}>
                  <Text style={{ fontSize: 20 }}>{f.icon}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.featureTitle}>{f.title}</Text>
                  <Text style={s.featureText}>{f.text}</Text>
                </View>
              </View>
            ))}
          </View>
          <View style={[s.row, { flexWrap: 'wrap', gap: 8, marginTop: 28 }]}>
            {DEPARTMENTS.map((d) => (
              <View key={d} style={s.deptChip}>
                <Text style={s.deptChipText}>{d}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );

  const form = (
    <View style={[s.panel, wide && { width: 440 }]}>
      <View style={s.card}>
        <Text style={s.cardTitle}>مرحباً بك 👋</Text>
        <Text style={s.cardSubtitle}>سجّل دخولك لمتابعة سجلات سلامة الغذاء</Text>

        {serverBanner ? (
          <View style={[s.errorBox, { marginBottom: 16 }]}>
            <Text style={s.errorText}>🔌 {serverBanner}</Text>
          </View>
        ) : null}

        <Field
          label="البريد الإلكتروني"
          icon="✉️"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="name@daraldhiafa.sa"
          returnKeyType="next"
        />
        <Field
          label="كلمة المرور"
          icon="🔒"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          autoComplete="password"
          placeholder="••••••••"
          onSubmitEditing={submit}
          returnKeyType="go"
          right={
            <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10} accessibilityLabel="إظهار كلمة المرور">
              <Text style={s.toggle}>{showPassword ? 'إخفاء' : 'إظهار'}</Text>
            </Pressable>
          }
        />

        {error ? (
          <View style={s.errorBox}>
            <Text style={s.errorText}>⚠️ {error}</Text>
          </View>
        ) : null}

        <Button title="تسجيل الدخول" onPress={submit} loading={busy} disabled={!email || !password} />

        <View style={s.divider}>
          <View style={s.dividerLine} />
          <Text style={s.dividerText}>حسابات التجربة</Text>
          <View style={s.dividerLine} />
        </View>
        <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>
          {DEMO_ACCOUNTS.map((a) => (
            <Pressable
              key={a.email}
              onPress={() => {
                setEmail(a.email);
                setError(null);
              }}
              style={({ pressed }) => [s.demoChip, email === a.email && s.demoChipActive, pressed && { opacity: 0.8 }]}
            >
              <Text style={[s.demoChipText, email === a.email && { color: colors.primary }]}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <InstallPrompt />
      <View style={[s.row, { justifyContent: 'center', gap: 6 }]}>
        <View style={[s.dot, { backgroundColor: server === 'ok' ? '#32D583' : server === 'checking' ? '#A9CDB9' : '#F97066' }]} />
        <Text style={s.footer}>
          {server === 'ok' ? 'الخادم متصل' : server === 'checking' ? 'جارٍ فحص الاتصال…' : 'الخادم غير متاح'} · © دار الضيافة · الإصدار 1.0
        </Text>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[s.blob, { top: -120, left: -80 }]} />
      <View style={[s.blob, { bottom: -160, right: -100, width: 420, height: 420 }]} />
      <ScrollView contentContainerStyle={[s.scroll, wide && s.scrollWide]} keyboardShouldPersistTaps="handled">
        <View style={[s.container, wide && s.containerWide]}>
          {brand}
          {form}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.primary, overflow: 'hidden' },
  blob: { position: 'absolute', width: 340, height: 340, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)' },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 16, paddingVertical: 40 },
  scrollWide: { padding: 48 },
  container: { width: '100%', maxWidth: 460, alignSelf: 'center' },
  containerWide: { maxWidth: 1120, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 64 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },

  brand: { flex: 1 },
  logo: { width: 84, height: 84, borderRadius: 22 },
  logoLg: { width: 96, height: 96, borderRadius: 26 },
  brandTitle: { fontSize: 40, fontWeight: '800', color: '#fff', textAlign: textStart },
  brandSubtitle: { fontSize: 16, color: '#CFE5D9', marginTop: 4, textAlign: textStart },
  features: { marginTop: 40, gap: 22 },
  feature: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  featureIcon: {
    width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(200,162,74,0.5)',
  },
  featureTitle: { fontSize: 17, fontWeight: '700', color: '#fff', textAlign: textStart },
  featureText: { fontSize: 14, color: '#CFE5D9', marginTop: 3, lineHeight: 21, textAlign: textStart },
  deptChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  deptChipText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  panel: { width: '100%' },
  card: {
    backgroundColor: '#fff', borderRadius: 20, padding: 28, marginBottom: 14,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 8,
  },
  cardTitle: { fontSize: 24, fontWeight: '800', color: colors.text, textAlign: textStart },
  cardSubtitle: { fontSize: 14, color: colors.muted, marginTop: 4, marginBottom: 24, textAlign: textStart },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8, textAlign: textStart },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: 12, paddingHorizontal: 14, backgroundColor: '#F9FAFB',
  },
  fieldFocused: { borderColor: colors.primary, backgroundColor: '#fff' },
  fieldIcon: { fontSize: 16, opacity: 0.7 },
  input: { flex: 1, paddingVertical: 13, fontSize: 16, color: colors.text, textAlign: textStart },
  toggle: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  errorBox: { backgroundColor: colors.dangerLight, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#F5C2BD' },
  errorText: { color: colors.danger, fontSize: 14, textAlign: textStart },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20, marginBottom: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#EAECF0' },
  dividerText: { color: colors.muted, fontSize: 12 },
  demoChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  demoChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  demoChipText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  footer: { color: '#A9CDB9', fontSize: 12, textAlign: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
