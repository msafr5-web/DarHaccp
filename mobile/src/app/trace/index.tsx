import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import type { TraceResult } from '@/api/types';
import { Badge, Button, Card, Empty, Input, styles } from '@/components/ui';
import { colors, textStart } from '@/theme';

/**
 * Reverse traceability (recall): everything the company recorded about one batch / lot number —
 * receipt and inspection, stock counts and issues (where it went), deviations and NCRs.
 */
export default function TraceScreen() {
  const [batch, setBatch] = useState('');
  const [result, setResult] = useState<TraceResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api<TraceResult>(`/traceability?batch=${encodeURIComponent(batch.trim())}`));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const issued = result?.records.filter((r) => r.template_code === 'STOCK_ISSUE') ?? [];
  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Card style={{ backgroundColor: colors.primaryLight }}>
        <Text style={styles.body}>
          أدخل رقم التشغيلة (Lot / Batch) لتتبّعها عكسياً: من استُلمت ومتى، نتائج الفحص، الأرصدة، وإلى أين صُرفت — أساس قرار سحب المنتج (Recall).
        </Text>
      </Card>
      <Input label="رقم التشغيلة" value={batch} onChangeText={setBatch} autoCapitalize="characters" placeholder="L-2026-001" onSubmitEditing={search} />
      <Button title="🔎 تتبّع" loading={busy} disabled={!batch.trim()} onPress={search} />
      {error ? <Text style={{ color: colors.danger, textAlign: textStart }}>{error}</Text> : null}

      {result ? (
        <>
          {result.stock.map((s) => (
            <Card key={s.id}>
              <Text style={styles.title}>{s.item_name} ({s.item_code})</Text>
              <Text style={styles.muted}>تشغيلة {s.batch_number} · تنتهي {s.expiry_date}</Text>
              <Text style={[styles.body, { marginTop: 4 }]}>الرصيد الحالي {s.quantity} · إجمالي المصروف {s.issued_total}</Text>
            </Card>
          ))}
          {result.ncrs.length ? (
            <Card style={{ backgroundColor: colors.warningLight }}>
              <Text style={styles.title}>تقارير عدم المطابقة</Text>
              {result.ncrs.map((n) => (
                <Pressable key={n.id} onPress={() => router.push({ pathname: '/incidents/[id]', params: { id: n.id } })}>
                  <Text style={[styles.body, { paddingVertical: 4 }]}>📋 {n.incident_no} — {n.title} ({n.status === 'CLOSED' ? 'مغلق' : 'مفتوح'})</Text>
                </Pressable>
              ))}
            </Card>
          ) : null}
          {issued.length ? (
            <Card>
              <Text style={styles.title}>أين صُرفت؟</Text>
              {issued.map((r) => (
                <Text key={r.id} style={[styles.body, { paddingVertical: 3 }]}>
                  📤 {String(r.data.issued_qty)} ← {String(r.data.issued_to ?? '')} · {new Date(r.recorded_at).toLocaleString('ar-SA')}
                </Text>
              ))}
            </Card>
          ) : null}
          <Text style={[styles.title, { marginVertical: 8 }]}>السجلات ({result.records.length})</Text>
          {!result.records.length && !result.stock.length ? <Empty text="لا توجد سجلات لهذه التشغيلة" /> : null}
          {result.records.map((r) => (
            <Pressable key={r.id} onPress={() => router.push({ pathname: '/records/[id]', params: { id: r.id, department: r.department_code } })}>
              <Card style={{ borderRightWidth: 4, borderRightColor: r.status === 'PASS' ? colors.success : colors.danger, paddingVertical: 10 }}>
                <View style={[styles.row, { justifyContent: 'space-between' }]}>
                  <Text style={[styles.body, { fontWeight: '700', flex: 1 }]}>{r.template_title_ar}</Text>
                  <Badge text={r.status === 'PASS' ? 'مطابق' : 'انحراف'} color={r.status === 'PASS' ? colors.success : colors.danger} />
                </View>
                <Text style={styles.muted}>{new Date(r.recorded_at).toLocaleString('ar-SA')} · {r.recorded_by_name}</Text>
                {r.ncr_no ? <Text style={[styles.muted, { color: colors.warning }]}>📋 {r.ncr_no}</Text> : null}
              </Card>
            </Pressable>
          ))}
          <View style={{ height: 20 }} />
        </>
      ) : null}
    </ScrollView>
  );
}
