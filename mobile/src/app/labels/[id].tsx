import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, ScrollView, Text, View } from 'react-native';
import { absoluteUrl, api, errorMessage } from '@/api/client';
import type { ProductLabel } from '@/api/types';
import { Badge, Button, Card, Empty, Input, Loading, styles } from '@/components/ui';
import { LABEL_STATE } from '@/constants';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { colors, departmentLabel, textStart } from '@/theme';

const fmt = (d: string) => new Date(d).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' });
const hoursText = (h: number) =>
  h <= 0 ? `منتهي منذ ${Math.abs(Math.round(h))} ساعة` : h < 48 ? `متبقٍ ${Math.round(h)} ساعة` : `متبقٍ ${Math.round(h / 24)} يوم`;

export default function LabelScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useAuth();
  const { data: label, error, setData } = useApi<ProductLabel>(`/labels/${id}`);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (error) return <Empty text={error} />;
  if (!label) return <Loading />;

  const state = LABEL_STATE[label.state];
  const active = label.status === 'ACTIVE';

  const print = async () => {
    // Open the tab synchronously (inside the click) so pop-up blockers allow it, then load the
    // fresh short-lived signed link: the print page opens outside the app session.
    const tab = Platform.OS === 'web' ? window.open('', '_blank') : null;
    try {
      const { url } = await api<{ url: string }>(`/labels/${id}/print-link`, { method: 'POST' });
      if (tab) tab.location.href = url;
      else await Linking.openURL(absoluteUrl(url));
    } catch (e) {
      tab?.close();
      throw e;
    }
  };

  const setStatus = async (status: 'CONSUMED' | 'DISCARDED') => {
    setBusy(true);
    setActionError(null);
    try {
      setData(await api<ProductLabel>(`/labels/${id}/status`, { method: 'PATCH', body: { status, reason: reason.trim() || undefined } }));
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Card style={active ? { backgroundColor: `${state.color}12`, borderColor: state.color } : undefined}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text style={[styles.title, { flex: 1, fontSize: 20 }]}>{label.product_name}</Text>
          <Badge text={active ? state.label : label.status === 'CONSUMED' ? 'تم الاستخدام' : 'تم الإتلاف'} color={active ? state.color : colors.muted} />
        </View>
        <Text style={styles.muted}>{label.label_no} · دفعة {label.batch_no} · {label.quantity} {label.unit} · {departmentLabel[label.department_code]}</Text>
        {active ? <Text style={{ fontSize: 22, fontWeight: '900', color: state.color, marginTop: 10, textAlign: textStart }}>{hoursText(label.hours_left)}</Text> : null}
      </Card>

      <Card>
        <Text style={styles.body}>تاريخ الإنتاج: <Text style={{ fontWeight: '700' }}>{fmt(label.produced_at)}</Text></Text>
        <Text style={styles.body}>تاريخ الانتهاء: <Text style={{ fontWeight: '700', color: colors.danger }}>{fmt(label.expires_at)}</Text></Text>
        {label.storage_temp_max !== null ? <Text style={styles.body}>الحفظ: عند {label.storage_temp_max}°م أو أقل</Text> : null}
        <Text style={[styles.body, { marginTop: 8 }]}>المكونات: {label.ingredients.map((i) => i.name).join('، ')}</Text>
        {label.allergens.length ? <Text style={[styles.body, { color: colors.warning, fontWeight: '700' }]}>مسببات الحساسية: {label.allergens.join('، ')}</Text> : null}
        <Text style={styles.muted}>أعدّه: {label.produced_by_name}</Text>
        {label.status_reason ? <Text style={styles.muted}>السبب: {label.status_reason}</Text> : null}
      </Card>

      <Button title="🖨️ طباعة بطاقة البيانات (مع QR)" variant="outline" onPress={() => print().catch((e) => setActionError(errorMessage(e)))} />

      {active && can('label:create') ? (
        <Card>
          <Input label="ملاحظة / سبب الإتلاف" value={reason} onChangeText={setReason} placeholder="مطلوب عند الإتلاف" />
          {actionError ? <Text style={{ color: colors.danger, marginBottom: 8, textAlign: textStart }}>{actionError}</Text> : null}
          {label.state !== 'EXPIRED' ? (
            <Button title="✔ تم استخدام/صرف المنتج" onPress={() => setStatus('CONSUMED')} loading={busy} />
          ) : (
            <Text style={[styles.body, { color: colors.danger, fontWeight: '700', marginBottom: 6 }]}>
              ⛔ المنتج منتهي الصلاحية — لا يجوز استخدامه، سجّل إتلافه.
            </Text>
          )}
          <Button title="🗑️ تسجيل الإتلاف" variant="danger" onPress={() => setStatus('DISCARDED')} loading={busy} disabled={!reason.trim()} />
        </Card>
      ) : actionError ? (
        <Text style={{ color: colors.danger, textAlign: textStart }}>{actionError}</Text>
      ) : null}
    </ScrollView>
  );
}
