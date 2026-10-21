import { useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import type { StaffMember } from '@/api/types';
import { Badge, Card, Chips, Empty, Input, OfflineNote, styles } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { colors, departmentLabel } from '@/theme';

const FITNESS = {
  FIT: { label: 'لائق للعمل', color: colors.success },
  EXPIRING_SOON: { label: 'الشهادة تنتهي قريباً', color: colors.warning },
  UNFIT: { label: 'غير لائق — يُمنع من تداول الغذاء', color: colors.danger },
} as const;

/** PRD §3 Staff & Health Certificates + §4.1 the 30-day pre-expiry warning. */
export default function StaffScreen() {
  const [fitness, setFitness] = useState<'ALL' | keyof typeof FITNESS>('ALL');
  const [search, setSearch] = useState('');
  const query = new URLSearchParams({ pageSize: '200', ...(fitness !== 'ALL' ? { fitness } : {}), ...(search.trim() ? { search: search.trim() } : {}) });
  const { data, error, loading, offline, reload } = useApi<StaffMember[]>(`/staff?${query}`);

  return (
    <FlatList
      contentContainerStyle={styles.page}
      data={data ?? []}
      keyExtractor={(s) => s.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      ListHeaderComponent={
        <View>
          <OfflineNote show={offline} />
          <Input placeholder="بحث بالاسم أو الرقم الوظيفي أو آخر 4 أرقام من الهوية" value={search} onChangeText={setSearch} />
          <Chips
            value={fitness}
            onChange={setFitness}
            options={[{ value: 'ALL', label: 'الكل' }, ...Object.entries(FITNESS).map(([value, f]) => ({ value: value as keyof typeof FITNESS, label: f.label, color: f.color }))]}
          />
          {error ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={loading ? undefined : <Empty text="لا يوجد عاملون مطابقون" />}
      renderItem={({ item }) => (
        <Card style={{ borderRightWidth: 5, borderRightColor: FITNESS[item.fitness].color }}>
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <Text style={[styles.title, { fontSize: 16, flex: 1 }]}>{item.full_name}</Text>
            <Badge text={FITNESS[item.fitness].label} color={FITNESS[item.fitness].color} />
          </View>
          <Text style={styles.muted}>
            {item.employee_no} · {item.job_title ?? '—'} · {departmentLabel[item.department_code]} · {item.nationality ?? ''}
            {item.id_number_last4 ? ` · هوية ••••${item.id_number_last4}` : ''}
          </Text>
          <Text style={[styles.body, { marginTop: 6 }]}>
            شهادة البلدية: {item.municipality_cert_no ?? 'غير مسجلة'}
            {item.cert_expiry_date ? ` · تنتهي ${item.cert_expiry_date} (${item.days_to_expiry! >= 0 ? `بعد ${item.days_to_expiry} يوم` : 'منتهية'})` : ''}
          </Text>
          <Text style={styles.muted}>
            آخر فحص صحي يومي: {item.last_daily_check ? new Date(item.last_daily_check).toLocaleString('ar-SA') : 'لا يوجد'}
          </Text>
        </Card>
      )}
    />
  );
}
