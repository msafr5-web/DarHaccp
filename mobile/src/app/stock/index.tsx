import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import type { FormTemplateSummary, StockBatch, StockMovement } from '@/api/types';
import { Badge, Card, Chips, Empty, Input, OfflineNote, Stat, styles } from '@/components/ui';
import { EXPIRY_STATUS, STORAGE_CONDITION } from '@/constants';
import { useApi } from '@/hooks/useApi';
import { colors } from '@/theme';

type Filter = 'available' | 'expiring' | 'expired' | 'all';

function Movements({ batch }: { batch: StockBatch }) {
  const { data } = useApi<StockMovement[]>(`/stock/batches/${batch.id}/movements`);
  if (!data) return <Text style={styles.muted}>…</Text>;
  return (
    <View style={{ marginTop: 8, borderTopWidth: 1, borderColor: '#F2F4F7', paddingTop: 6 }}>
      {data.map((m) => (
        <Pressable key={m.id} onPress={() => router.push({ pathname: '/records/[id]', params: { id: m.record_id, department: m.department_code } })}>
          <Text style={[styles.muted, { paddingVertical: 2 }]}>
            {m.movement === 'COUNT' ? '📋 جرد' : '📤 صرف'} · {m.quantity_before} ← {m.quantity_after} · {m.created_by_name} · {new Date(m.created_at).toLocaleString('ar-SA')}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** FEFO stock: every batch in expiry order; issue opens the issuing form on the batch that must go first. */
export default function StockScreen() {
  const [filter, setFilter] = useState<Filter>('available');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, loading, offline, reload } = useApi<StockBatch[]>(`/stock/batches?status=${filter}`);
  const { data: all } = useApi<StockBatch[]>('/stock/batches?status=available');
  const { data: templates } = useApi<FormTemplateSummary[]>('/haccp/templates');
  const issueForm = templates?.find((t) => t.code === 'STOCK_ISSUE');
  const countForm = templates?.find((t) => t.code === 'INVENTORY_STOCK');

  const stats = useMemo(() => {
    const list = all ?? [];
    return {
      batches: list.length,
      expiring: list.filter((b) => b.expiry_alert_status === 'Expiring Soon').length,
      expired: list.filter((b) => b.expiry_alert_status === 'Expired').length,
      items: new Set(list.map((b) => b.item_code)).size,
    };
  }, [all]);

  const q = search.trim().toLowerCase();
  const rows = (data ?? []).filter((b) => !q || b.item_code.toLowerCase().includes(q) || b.item_name.toLowerCase().includes(q) || b.batch_number.toLowerCase().includes(q));

  return (
    <FlatList
      contentContainerStyle={styles.page}
      data={rows}
      keyExtractor={(b) => b.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      ListHeaderComponent={
        <View>
          <OfflineNote show={offline} />
          <Card>
            <View style={[styles.row, { flexWrap: 'wrap' }]}>
              <Stat label="أصناف بها رصيد" value={stats.items} />
              <Stat label="تشغيلات" value={stats.batches} color={colors.primary} />
              <Stat label="تنتهي خلال 7 أيام" value={stats.expiring} color={stats.expiring ? colors.warning : colors.muted} />
              <Stat label="منتهية — تُوجَّه للهالك" value={stats.expired} color={stats.expired ? colors.danger : colors.muted} />
            </View>
          </Card>
          <Card style={{ backgroundColor: colors.primaryLight }}>
            <Text style={styles.body}>
              محرك FEFO: يُفرض صرف التشغيلة الأقرب انتهاءً أولاً، ويُمنع صرف المنتهي أو أكثر من الرصيد. الرصيد يُحدَّث من نموذج الجرد ونموذج الصرف.
            </Text>
            <View style={[styles.row, { marginTop: 8, flexWrap: 'wrap' }]}>
              {countForm ? (
                <Pressable onPress={() => router.push({ pathname: '/form', params: { payload: countForm.qr_token, source: 'MANUAL' } })}>
                  <Text style={{ color: colors.primary, fontWeight: '800' }}>📋 جرد / إدخال رصيد</Text>
                </Pressable>
              ) : null}
              {issueForm ? (
                <Pressable onPress={() => router.push({ pathname: '/form', params: { payload: issueForm.qr_token, source: 'MANUAL' } })}>
                  <Text style={{ color: colors.primary, fontWeight: '800', marginHorizontal: 16 }}>📤 صرف مخزون</Text>
                </Pressable>
              ) : null}
            </View>
          </Card>
          <Input placeholder="بحث بالصنف أو رقم التشغيلة" value={search} onChangeText={setSearch} />
          <Chips value={filter} onChange={setFilter} options={[
            { value: 'available', label: 'بها رصيد' }, { value: 'expiring', label: 'تنتهي قريباً', color: colors.warning },
            { value: 'expired', label: 'منتهية', color: colors.danger }, { value: 'all', label: 'الكل' },
          ]} />
          {error ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={loading ? undefined : <Empty text="لا توجد تشغيلات" />}
      renderItem={({ item: b, index }) => {
        const header = index === 0 || rows[index - 1]!.item_code !== b.item_code;
        const st = EXPIRY_STATUS[b.expiry_alert_status]!;
        const storage = b.storage_condition ? STORAGE_CONDITION[b.storage_condition] : null;
        return (
          <View>
            {header ? (
              <Text style={[styles.title, { fontSize: 16, marginTop: 6, marginBottom: 6 }]}>
                {storage?.icon ?? '📦'} {b.item_name} <Text style={styles.muted}>({b.item_code})</Text>
              </Text>
            ) : null}
            <Pressable onPress={() => setOpen(open === b.id ? null : b.id)}>
              <Card style={{ borderRightWidth: 5, borderRightColor: st.color, paddingVertical: 12 }}>
                <View style={[styles.row, { justifyContent: 'space-between' }]}>
                  <Text style={[styles.body, { fontWeight: '800', flex: 1 }]}>تشغيلة {b.batch_number}</Text>
                  {b.fefo_next ? <Badge text="⬅ تُصرف أولاً" color={colors.success} /> : null}
                  <Badge text={st.label} color={st.color} />
                </View>
                <Text style={styles.muted}>
                  ينتهي {b.expiry_date} ({b.days_remaining < 0 ? `منذ ${-b.days_remaining} يوم` : `${b.days_remaining} يوم`}) · الرصيد {b.quantity} {b.unit ?? ''}
                </Text>
                {b.fefo_next && issueForm ? (
                  <Pressable onPress={() => router.push({ pathname: '/form', params: {
                    payload: issueForm.qr_token, source: 'MANUAL', values: JSON.stringify({ item_code: b.item_code, batch_number: b.batch_number }),
                  } })}>
                    <Text style={{ color: colors.primary, fontWeight: '800', marginTop: 6 }}>📤 صرف من هذه التشغيلة</Text>
                  </Pressable>
                ) : null}
                {open === b.id ? <Movements batch={b} /> : null}
              </Card>
            </Pressable>
          </View>
        );
      }}
    />
  );
}
