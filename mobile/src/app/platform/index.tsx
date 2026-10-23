import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import type { TenantDetails, TenantStatus } from '@/api/types';
import { Badge, Button, Card, Chips, Empty, Input, Stat, styles } from '@/components/ui';
import { TENANT_STATUS } from '@/constants';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { colors } from '@/theme';

interface PlatformStats {
  pending_review: number;
  pending_verification: number;
  active: number;
  suspended: number;
  rejected: number;
  registrations_30d: number;
  failed_logins_24h: number;
  logins_24h: number;
}

/** SaaS operator console: companies awaiting review first. */
export default function PlatformScreen() {
  const { user, signOut } = useAuth();
  const [status, setStatus] = useState<'ALL' | TenantStatus>('PENDING_REVIEW');
  const [search, setSearch] = useState('');
  const q = new URLSearchParams({ pageSize: '200', ...(status !== 'ALL' ? { status } : {}), ...(search.trim() ? { search: search.trim() } : {}) });
  const { data, error, loading, reload } = useApi<TenantDetails[]>(`/platform/tenants?${q}`);
  const { data: stats, reload: reloadStats } = useApi<PlatformStats>('/platform/stats');

  return (
    <FlatList
      contentContainerStyle={styles.page}
      data={data ?? []}
      keyExtractor={(t) => String(t.id)}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { void reload(); void reloadStats(); }} />}
      ListHeaderComponent={
        <View>
          <Card>
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>لوحة إدارة منصة DarHaccp</Text>
                <Text style={styles.muted}>{user?.full_name} · مراجعة الشركات واعتمادها</Text>
              </View>
              <Button title="خروج" variant="outline" onPress={signOut} />
            </View>
          </Card>
          {stats ? (
            <Card>
              <View style={[styles.row, { flexWrap: 'wrap' }]}>
                <Stat label="بانتظار المراجعة" value={stats.pending_review} color={colors.warning} />
                <Stat label="شركات نشطة" value={stats.active} color={colors.success} />
                <Stat label="موقوفة" value={stats.suspended} color={colors.danger} />
                <Stat label="تسجيلات 30 يوماً" value={stats.registrations_30d} />
                <Stat label="دخول ناجح 24س" value={stats.logins_24h} color={colors.primary} />
                <Stat label="محاولات فاشلة 24س" value={stats.failed_logins_24h} color={colors.danger} />
              </View>
            </Card>
          ) : null}
          <Button title="🧩 مكتبة النماذج (الحقول والخصائص)" onPress={() => router.push('/platform/forms')} />
          <Button title="🔐 سجل محاولات الدخول لكل الشركات" variant="outline" onPress={() => router.push('/platform/attempts')} />
          <View style={{ height: 10 }} />
          <Input placeholder="بحث بالاسم أو الرمز أو البريد أو الجوال أو الرقم التعريفي" value={search} onChangeText={setSearch} />
          <Chips value={status} onChange={setStatus}
            options={[{ value: 'ALL', label: 'الكل' }, ...(Object.keys(TENANT_STATUS) as TenantStatus[]).map((s) => ({ value: s, label: TENANT_STATUS[s].label, color: TENANT_STATUS[s].color }))]} />
          {error ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={loading ? undefined : <Empty text="لا توجد شركات في هذه الحالة" />}
      renderItem={({ item }) => (
        <Pressable onPress={() => router.push({ pathname: '/platform/[id]', params: { id: String(item.id) } })}>
          <Card style={{ borderRightWidth: 5, borderRightColor: TENANT_STATUS[item.status].color }}>
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Text style={[styles.title, { fontSize: 16, flex: 1 }]}>{item.name}</Text>
              <Badge text={TENANT_STATUS[item.status].label} color={TENANT_STATUS[item.status].color} />
            </View>
            <Text style={[styles.body, { fontWeight: '700', color: colors.primary }]} selectable>{item.code}</Text>
            <Text style={styles.muted}>
              {item.account_no} · {item.email} · {item.phone} · سُجّلت {new Date(item.created_at).toLocaleDateString('ar-SA')}
            </Text>
            {item.status === 'ACTIVE' ? (
              <Text style={styles.muted}>المستخدمون: {item.users_count} · السجلات: {item.records_count}
                {item.last_login_at ? ` · آخر دخول ${new Date(item.last_login_at).toLocaleString('ar-SA')}` : ''}</Text>
            ) : null}
          </Card>
        </Pressable>
      )}
    />
  );
}
