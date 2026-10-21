import { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { colors, textStart } from '../theme';

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'outline' | 'danger';
  loading?: boolean;
  disabled?: boolean;
}) {
  const bg = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.danger : 'transparent';
  const fg = variant === 'outline' ? colors.primary : '#fff';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: variant === 'outline' ? colors.primary : bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Input(props: TextInputProps & { label?: string; hint?: string; error?: boolean }) {
  const { label, hint, error, style, ...rest } = props;
  return (
    <View style={{ marginBottom: 14 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.muted}
        style={[styles.input, error && { borderColor: colors.danger, backgroundColor: colors.dangerLight }, style]}
        {...rest}
      />
      {hint ? <Text style={[styles.hint, error && { color: colors.danger }]}>{hint}</Text> : null}
    </View>
  );
}

export function Badge({ text, color }: { text: string; color: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: `${color}1A`, borderColor: color }]}>
      <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

export function Stat({ label, value, color = colors.text }: { label: string; value: string | number; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/** Single-choice pill selector (filters, enums). */
export function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string; color?: string }[];
  value: T | null | undefined;
  onChange: (v: T) => void;
}) {
  return (
    <View style={[styles.row, { flexWrap: 'wrap', marginBottom: 12 }]}>
      {options.map((o) => {
        const active = o.value === value;
        const c = o.color ?? colors.primary;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={{
              paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5,
              borderColor: active ? c : colors.border, backgroundColor: active ? `${c}1A` : '#fff',
            }}
          >
            <Text style={{ color: active ? c : colors.text, fontWeight: '700', fontSize: 13 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Offline indicator for screens showing cached data. */
export function OfflineNote({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <View style={{ backgroundColor: colors.warningLight, borderRadius: 10, padding: 10, marginBottom: 12 }}>
      <Text style={{ color: colors.warning, fontWeight: '700', textAlign: textStart }}>📴 دون اتصال — تُعرض آخر بيانات محفوظة</Text>
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <View style={[styles.center, { padding: 32 }]}>
      <Text style={{ color: colors.muted, textAlign: 'center' }}>{text}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  page: { padding: 16, width: '100%', maxWidth: 960, alignSelf: 'center' },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#EAECF0',
  },
  button: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1.5, marginVertical: 6 },
  buttonText: { fontSize: 16, fontWeight: '700' },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 6, textAlign: textStart },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#fff',
    color: colors.text,
  },
  hint: { fontSize: 12, color: colors.muted, marginTop: 4, textAlign: textStart },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  statValue: { fontSize: 24, fontWeight: '800' },
  statLabel: { fontSize: 12, color: colors.muted, marginTop: 2, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: colors.text, textAlign: textStart },
  body: { fontSize: 14, color: colors.text, textAlign: textStart, lineHeight: 21 },
  muted: { fontSize: 13, color: colors.muted, textAlign: textStart },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
