import { Linking, Pressable, Text, View } from 'react-native';
import type { GuideSource, Verification } from '../api/types';
import { colors, textStart } from '../theme';
import { Badge, styles } from './ui';

export const VERIFICATION: Record<Verification, { label: string; color: string }> = {
  OFFICIAL: { label: 'رسمي', color: colors.success },
  REPORTED: { label: 'منقول عن المراكز الطبية — غير رسمي', color: colors.warning },
  UNVERIFIED: { label: 'غير مؤكَّد — تحقق من بلدي', color: colors.danger },
};

export const dmy = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

export function VerificationBadge({ v }: { v: Verification }) {
  return <Badge text={VERIFICATION[v].label} color={VERIFICATION[v].color} />;
}

/** Where an item comes from, with a link to the page it was read from. */
export function SourceLine({ code, sources }: { code: string | null; sources: GuideSource[] }) {
  const s = sources.find((x) => x.code === code);
  if (!s) return null;
  return (
    <View style={{ marginTop: 6 }}>
      <Pressable disabled={!s.url} onPress={() => s.url && void Linking.openURL(s.url)}>
        <Text style={{ fontSize: 12, color: s.url ? colors.primary : colors.muted, textAlign: textStart }} numberOfLines={2}>
          📎 {s.publisher} — {s.title}
        </Text>
      </Pressable>
    </View>
  );
}

export function Pill({ text, color = colors.muted }: { text: string; color?: string }) {
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: `${color}14`, marginEnd: 6, marginBottom: 6 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color }}>{text}</Text>
    </View>
  );
}

export function Section({ title }: { title: string }) {
  return <Text style={[styles.title, { marginTop: 14, marginBottom: 8, fontSize: 16, color: colors.primary }]}>{title}</Text>;
}
