import { ReactNode, useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { checkServerHealth } from '../api/client';
import { colors, textStart } from '../theme';

const logo = require('../../assets/icon.png');

const FEATURES = [
  { icon: '🏢', title: 'حساب مستقل لكل شركة', text: 'بيانات كل شركة معزولة تماماً على مستوى قاعدة البيانات برمز تعريفي فريد' },
  { icon: '📷', title: 'مسح QR فوري', text: 'نموذج رقمي لكل جهاز ومرحلة إنتاج بدل السجلات الورقية' },
  { icon: '🌡️', title: 'نقاط التحكم الحرجة', text: 'تحقق تلقائي من الحدود الحرجة مع تنبيه وإجراء تصحيحي فوري' },
  { icon: '🔐', title: 'دخول آمن برمز OTP', text: 'رمز تحقق على البريد عند كل تسجيل دخول مع سجل كامل للمحاولات' },
];

export type ServerState = 'checking' | 'ok' | 'degraded' | 'unreachable';

export function useServerHealth() {
  const [server, setServer] = useState<ServerState>('checking');
  useEffect(() => {
    let active = true;
    checkServerHealth().then((s) => active && setServer(s));
    return () => {
      active = false;
    };
  }, []);
  return [server, () => checkServerHealth().then(setServer)] as const;
}

/** Green branded frame shared by sign-in, company registration, activation and password reset. */
export function AuthShell({ children, server, showFeatures = false }: { children: ReactNode; server?: ServerState; showFeatures?: boolean }) {
  const { width } = useWindowDimensions();
  const wide = width >= 960;

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[s.blob, { top: -120, left: -80 }]} />
      <View style={[s.blob, { bottom: -160, right: -100, width: 420, height: 420 }]} />
      <ScrollView contentContainerStyle={[s.scroll, wide && { padding: 48 }]} keyboardShouldPersistTaps="handled">
        <View style={[s.container, wide && s.containerWide]}>
          <View style={[{ flex: 1 }, !wide && { alignItems: 'center', marginBottom: 24 }]}>
            <View style={[s.row, !wide && { flexDirection: 'column' }]}>
              <Image source={logo} style={wide ? s.logoLg : s.logo} accessibilityLabel="شعار المنصة" />
              <View style={!wide && { alignItems: 'center', marginTop: 12 }}>
                <Text style={[s.brandTitle, !wide && { fontSize: 28, textAlign: 'center' }]}>DarHaccp</Text>
                <Text style={[s.brandSubtitle, !wide && { textAlign: 'center' }]}>منصة سلامة الغذاء والجودة للشركات · IMS & HACCP</Text>
              </View>
            </View>
            {wide && showFeatures ? (
              <View style={{ marginTop: 40, gap: 22 }}>
                {FEATURES.map((f) => (
                  <View key={f.title} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
                    <View style={s.featureIcon}><Text style={{ fontSize: 20 }}>{f.icon}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.featureTitle}>{f.title}</Text>
                      <Text style={s.featureText}>{f.text}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
          <View style={[{ width: '100%' }, wide && { width: 460 }]}>
            {children}
            {server ? (
              <View style={[s.row, { justifyContent: 'center', gap: 6, marginTop: 6 }]}>
                <View style={[s.dot, { backgroundColor: server === 'ok' ? '#32D583' : server === 'checking' ? '#A9CDB9' : '#F97066' }]} />
                <Text style={s.footer}>
                  {server === 'ok' ? 'الخادم متصل' : server === 'checking' ? 'جارٍ فحص الاتصال…' : 'الخادم غير متاح'} · © DarHaccp
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{title}</Text>
      {subtitle ? <Text style={s.cardSubtitle}>{subtitle}</Text> : <View style={{ height: 16 }} />}
      {children}
    </View>
  );
}

export function AuthField({ label, icon, right, hint, style, ...props }: React.ComponentProps<typeof TextInput> & {
  label: string; icon: string; right?: ReactNode; hint?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}</Text>
      <View style={[s.field, focused && s.fieldFocused]}>
        <Text style={{ fontSize: 16, opacity: 0.7 }}>{icon}</Text>
        <TextInput
          placeholderTextColor="#98A2B3"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[s.input, Platform.OS === 'web' && ({ outlineStyle: 'none' } as object), style]}
          {...props}
        />
        {right}
      </View>
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Notice({ text, tone = 'error' }: { text: string; tone?: 'error' | 'info' | 'success' }) {
  const c = tone === 'error' ? colors.danger : tone === 'success' ? colors.success : colors.primary;
  const bg = tone === 'error' ? colors.dangerLight : tone === 'success' ? colors.successLight : colors.primaryLight;
  return (
    <View style={{ backgroundColor: bg, borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: `${c}40` }}>
      <Text style={{ color: c, fontSize: 14, textAlign: textStart, lineHeight: 21 }}>{text}</Text>
    </View>
  );
}

export const authStyles = StyleSheet.create({
  link: { color: colors.primary, fontWeight: '700', fontSize: 14, textAlign: 'center', paddingVertical: 6 },
  otp: { fontSize: 30, letterSpacing: 12, fontWeight: '800', textAlign: 'center', paddingVertical: 12, color: colors.primary },
  codeBox: {
    backgroundColor: colors.primaryLight, borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 14,
    borderWidth: 1, borderColor: `${colors.primary}33`,
  },
  codeText: { fontSize: 22, fontWeight: '900', color: colors.primary, letterSpacing: 1 },
});

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.primary, overflow: 'hidden' },
  blob: { position: 'absolute', width: 340, height: 340, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)' },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 16, paddingVertical: 40 },
  container: { width: '100%', maxWidth: 480, alignSelf: 'center' },
  containerWide: { maxWidth: 1120, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 64 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  logo: { width: 84, height: 84, borderRadius: 22 },
  logoLg: { width: 96, height: 96, borderRadius: 26 },
  brandTitle: { fontSize: 40, fontWeight: '800', color: '#fff', textAlign: textStart },
  brandSubtitle: { fontSize: 16, color: '#CFE5D9', marginTop: 4, textAlign: textStart },
  featureIcon: {
    width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(200,162,74,0.5)',
  },
  featureTitle: { fontSize: 17, fontWeight: '700', color: '#fff', textAlign: textStart },
  featureText: { fontSize: 14, color: '#CFE5D9', marginTop: 3, lineHeight: 21, textAlign: textStart },
  card: {
    backgroundColor: '#fff', borderRadius: 20, padding: 28, marginBottom: 14,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 8,
  },
  cardTitle: { fontSize: 24, fontWeight: '800', color: colors.text, textAlign: textStart },
  cardSubtitle: { fontSize: 14, color: colors.muted, marginTop: 4, marginBottom: 22, textAlign: textStart, lineHeight: 21 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8, textAlign: textStart },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: 12, paddingHorizontal: 14, backgroundColor: '#F9FAFB',
  },
  fieldFocused: { borderColor: colors.primary, backgroundColor: '#fff' },
  input: { flex: 1, paddingVertical: 13, fontSize: 16, color: colors.text, textAlign: textStart },
  hint: { fontSize: 12, color: colors.muted, marginTop: 4, textAlign: textStart },
  footer: { color: '#A9CDB9', fontSize: 12, textAlign: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
