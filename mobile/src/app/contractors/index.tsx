import { useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import type { Contractor } from '@/api/types';
import { Badge, Button, Card, Chips, Empty, Input, OfflineNote, styles } from '@/components/ui';
import { SERVICE_TYPES } from '@/constants';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { colors, textStart } from '@/theme';

const COMPLIANCE = {
  VALID: { label: 'ساري', color: colors.success },
  EXPIRING_SOON: { label: 'ينتهي خلال 30 يوماً', color: colors.warning },
  EXPIRED: { label: 'منتهٍ', color: colors.danger },
} as const;

const CRITERIA = [
  ['quality', 'جودة العمل'],
  ['compliance', 'الالتزام بالاشتراطات'],
  ['timeliness', 'الالتزام بالمواعيد'],
  ['safety', 'السلامة'],
  ['documentation', 'التوثيق والتقارير'],
] as const;
type Criterion = (typeof CRITERIA)[number][0];

const quarter = () => `${new Date().getFullYear()}-Q${Math.floor(new Date().getMonth() / 3) + 1}`;

function Evaluate({ contractor, onDone }: { contractor: Contractor; onDone: () => void }) {
  const [scores, setScores] = useState<Partial<Record<Criterion, string>>>({});
  const [period, setPeriod] = useState(quarter());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = CRITERIA.every(([k]) => scores[k]);
  const total = complete ? Math.round((CRITERIA.reduce((s, [k]) => s + Number(scores[k]), 0) / 25) * 100) : null;

  return (
    <View style={{ marginTop: 10, borderTopWidth: 1, borderColor: '#EAECF0', paddingTop: 10 }}>
      {CRITERIA.map(([key, label]) => (
        <View key={key}>
          <Text style={styles.label}>{label}</Text>
          <Chips options={['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: v }))} value={scores[key]} onChange={(v) => setScores((s) => ({ ...s, [key]: v }))} />
        </View>
      ))}
      <Input label="الفترة" value={period} onChangeText={setPeriod} placeholder="2026-Q4" />
      <Input label="ملاحظات" value={notes} onChangeText={setNotes} multiline />
      {total !== null ? (
        <Text style={[styles.body, { fontWeight: '700', marginBottom: 6 }]}>
          النتيجة: {total}% — {total >= 80 ? 'استمرار' : total >= 60 ? 'يحتاج تحسين' : 'إنهاء التعاقد (سيُوقف اعتماده)'}
        </Text>
      ) : null}
      {error ? <Text style={{ color: colors.danger, textAlign: textStart }}>{error}</Text> : null}
      <Button
        title="حفظ التقييم"
        loading={busy}
        disabled={!complete}
        onPress={async () => {
          setBusy(true);
          try {
            await api(`/contractors/${contractor.id}/evaluations`, {
              method: 'POST',
              body: { period, notes: notes.trim() || undefined, scores: Object.fromEntries(CRITERIA.map(([k]) => [k, Number(scores[k])])) },
            });
            onDone();
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </View>
  );
}

/** PRD §4.1 — contractors (pest control, maintenance, waste) with licence tracking and evaluation. */
export default function ContractorsScreen() {
  const { can } = useAuth();
  const [evaluating, setEvaluating] = useState<string | null>(null);
  const { data, error, loading, offline, reload } = useApi<Contractor[]>('/contractors');

  return (
    <FlatList
      contentContainerStyle={styles.page}
      data={data ?? []}
      keyExtractor={(c) => c.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      ListHeaderComponent={<View><OfflineNote show={offline} />{error ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text> : null}</View>}
      ListEmptyComponent={loading ? undefined : <Empty text="لا يوجد مقاولون مسجلون" />}
      renderItem={({ item }) => (
        <Card style={!item.is_approved ? { opacity: 0.7 } : undefined}>
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <Text style={[styles.title, { fontSize: 15, flex: 1 }]}>{item.name}</Text>
            <Badge text={item.is_approved ? COMPLIANCE[item.compliance_state].label : 'موقوف'} color={item.is_approved ? COMPLIANCE[item.compliance_state].color : colors.danger} />
          </View>
          <Text style={styles.muted}>
            {SERVICE_TYPES[item.service_type]} · ترخيص {item.license_no ?? '—'} ينتهي {item.license_expiry ?? '—'} · العقد حتى {item.contract_end ?? '—'}
          </Text>
          <Text style={styles.body}>
            آخر تقييم: {item.last_score !== null ? `${item.last_score}% (${item.last_period})` : 'لا يوجد'}
          </Text>
          {can('contractor:manage') ? (
            evaluating === item.id ? (
              <Evaluate contractor={item} onDone={() => { setEvaluating(null); void reload(); }} />
            ) : (
              <Button title="⭐ تقييم الأداء" variant="outline" onPress={() => setEvaluating(item.id)} />
            )
          ) : null}
        </Card>
      )}
    />
  );
}
