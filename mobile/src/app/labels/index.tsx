import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import type { ProductLabel } from '@/api/types';
import { Badge, Button, Card, Chips, Empty, OfflineNote, styles } from '@/components/ui';
import { LABEL_STATE } from '@/constants';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { colors, departmentLabel } from '@/theme';

const hoursText = (h: number) =>
  h <= 0 ? `منتهي منذ ${Math.abs(Math.round(h))} ساعة` : h < 48 ? `متبقٍ ${Math.round(h)} ساعة` : `متبقٍ ${Math.round(h / 24)} يوم`;

/** PRD §4.4 — product data cards with live shelf-life status. */
export default function LabelsScreen() {
  const { can } = useAuth();
  const [state, setState] = useState<'ALL' | keyof typeof LABEL_STATE>('ALL');
  const { data, error, loading, offline, reload } = useApi<ProductLabel[]>(
    `/labels?status=ACTIVE&pageSize=200${state !== 'ALL' ? `&state=${state}` : ''}`,
  );

  return (
    <FlatList
      contentContainerStyle={styles.page}
      data={data ?? []}
      keyExtractor={(l) => l.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      ListHeaderComponent={
        <View>
          <OfflineNote show={offline} />
          {can('label:create') ? <Button title="🏷️ إصدار بطاقة بيانات" onPress={() => router.push('/labels/new')} /> : null}
          <View style={{ height: 10 }} />
          <Chips value={state} onChange={setState}
            options={[{ value: 'ALL', label: 'كل المنتجات النشطة' }, ...Object.entries(LABEL_STATE).map(([value, s]) => ({ value: value as keyof typeof LABEL_STATE, label: s.label, color: s.color }))]} />
          {error ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={loading ? undefined : <Empty text="لا توجد منتجات نشطة" />}
      renderItem={({ item }) => (
        <Pressable onPress={() => router.push({ pathname: '/labels/[id]', params: { id: item.id } })}>
          <Card style={{ borderRightWidth: 5, borderRightColor: LABEL_STATE[item.state].color }}>
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Text style={[styles.title, { fontSize: 15, flex: 1 }]}>{item.product_name}</Text>
              <Badge text={LABEL_STATE[item.state].label} color={LABEL_STATE[item.state].color} />
            </View>
            <Text style={styles.muted}>
              {item.label_no} · دفعة {item.batch_no} · {item.quantity} {item.unit} · {departmentLabel[item.department_code]}
            </Text>
            <Text style={[styles.body, { fontWeight: '700', color: LABEL_STATE[item.state].color }]}>{hoursText(item.hours_left)}</Text>
          </Card>
        </Pressable>
      )}
    />
  );
}
