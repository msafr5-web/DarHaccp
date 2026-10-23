import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import type { Department, Equipment, QrLabel } from '@/api/types';
import { Badge, Button, Card, Chips, Empty, Input, OfflineNote, Stat, styles } from '@/components/ui';
import { MaintenanceBadge, TodayBadge, typeInfo } from '@/components/EquipmentBadges';
import { EQUIPMENT_STATUS, EQUIPMENT_TYPES } from '@/constants';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { LabelSize, printLabels } from '@/printLabels';
import { colors, departmentLabel, textStart } from '@/theme';

const DEPTS: ('ALL' | Department)[] = ['ALL', 'SUPPORT', 'HOT', 'COLD', 'SWEETS'];

/** Equipment & data loggers: each has a QR label that opens its monitoring form with the device pre-filled. */
export default function EquipmentScreen() {
  const { user, can } = useAuth();
  const manage = can('equipment:manage');
  const printable = can('qr:manage');
  const [department, setDepartment] = useState<'ALL' | Department>(user?.department_code ?? 'ALL');
  const [type, setType] = useState('ALL');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [size, setSize] = useState<LabelSize>('small');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const q = new URLSearchParams({
    ...(department !== 'ALL' ? { department } : {}), ...(type !== 'ALL' ? { type } : {}), ...(search.trim() ? { search: search.trim() } : {}),
  });
  const { data, error, loading, offline, reload } = useApi<Equipment[]>(`/equipment?${q}`);
  const list = data ?? [];

  const stats = useMemo(() => ({
    total: list.length,
    operational: list.filter((e) => e.status === 'OPERATIONAL').length,
    behind: list.filter((e) => e.min_daily_entries && e.readings_today < e.min_daily_entries).length,
    maintenance: list.filter((e) => e.days_to_maintenance !== null && e.days_to_maintenance <= 7).length,
  }), [list]);

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const print = async (ids: string[]) => {
    setBusy(true);
    setMessage(null);
    try {
      const labels = await api<QrLabel[]>('/qr/labels-data', { method: 'POST', body: { target: 'equipment', ids } });
      await printLabels(labels, size);
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FlatList
      contentContainerStyle={styles.page}
      data={list}
      keyExtractor={(e) => e.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      ListHeaderComponent={
        <View>
          <OfflineNote show={offline} />
          <Card>
            <View style={[styles.row, { flexWrap: 'wrap' }]}>
              <Stat label="الأجهزة" value={stats.total} />
              <Stat label="تعمل" value={stats.operational} color={colors.success} />
              <Stat label="قراءات ناقصة اليوم" value={stats.behind} color={stats.behind ? colors.warning : colors.muted} />
              <Stat label="صيانة مستحقة" value={stats.maintenance} color={stats.maintenance ? colors.danger : colors.muted} />
            </View>
          </Card>
          {manage ? <Button title="➕ إضافة جهاز / مسجل بيانات" onPress={() => router.push({ pathname: '/equipment/[id]', params: { id: 'new' } })} /> : null}
          <View style={{ height: 10 }} />
          <Input placeholder="بحث برقم الجهاز أو الاسم أو الموقع" value={search} onChangeText={setSearch} />
          {!user?.department_code ? (
            <Chips value={department} onChange={setDepartment}
              options={DEPTS.map((d) => ({ value: d, label: d === 'ALL' ? 'كل الأقسام' : departmentLabel[d] }))} />
          ) : null}
          <Chips value={type} onChange={setType}
            options={[{ value: 'ALL', label: 'كل الأنواع' }, ...Object.entries(EQUIPMENT_TYPES).map(([v, t]) => ({ value: v, label: `${t.icon} ${t.label}` }))]} />
          {printable && list.length ? (
            <Card style={{ backgroundColor: colors.primaryLight }}>
              <Text style={[styles.body, { fontWeight: '700', marginBottom: 6 }]}>🖨 طباعة ملصقات QR</Text>
              <Chips value={size} onChange={setSize} options={[{ value: 'small', label: 'صغير (3 في الصف)' }, { value: 'large', label: 'كبير (2 في الصف)' }]} />
              <View style={[styles.row, { flexWrap: 'wrap' }]}>
                <View style={{ flex: 1, minWidth: 150 }}>
                  <Button title={selected.size ? `طباعة المحدد (${selected.size})` : 'حدد أجهزة للطباعة'} disabled={!selected.size} loading={busy}
                    onPress={() => void print([...selected])} />
                </View>
                <View style={{ flex: 1, minWidth: 150 }}>
                  <Button title={`طباعة الكل (${list.length})`} variant="outline" loading={busy} onPress={() => void print(list.map((e) => e.id))} />
                </View>
              </View>
            </Card>
          ) : null}
          {error || message ? <Text style={{ color: colors.danger, marginBottom: 12, textAlign: textStart }}>{error ?? message}</Text> : null}
        </View>
      }
      ListEmptyComponent={loading ? undefined : <Empty text={manage ? 'لا توجد أجهزة — أضف أول جهاز أو مسجل بيانات' : 'لا توجد أجهزة'} />}
      renderItem={({ item: e }) => {
        const st = EQUIPMENT_STATUS[e.status]!;
        const t = typeInfo(e.type);
        const isSelected = selected.has(e.id);
        return (
          <Pressable onPress={() => router.push({ pathname: '/equipment/[id]', params: { id: e.id } })}>
            <Card style={{ borderRightWidth: 5, borderRightColor: st.color, ...(isSelected ? { borderColor: colors.primary, backgroundColor: '#F8FBF9' } : {}) }}>
              <View style={[styles.row, { justifyContent: 'space-between' }]}>
                <Text style={{ fontSize: 26 }}>{t.icon}</Text>
                <View style={{ flex: 1, marginHorizontal: 8 }}>
                  <Text style={[styles.body, { fontWeight: '800' }]}>{e.name}</Text>
                  <Text style={[styles.muted, { fontWeight: '700', color: colors.primary }]} selectable>{e.code}</Text>
                </View>
                {printable ? (
                  <Pressable onPress={() => toggle(e.id)} hitSlop={10}
                    style={{ width: 28, height: 28, borderRadius: 6, borderWidth: 2, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center',
                      backgroundColor: isSelected ? colors.primary : '#fff' }}>
                    <Text style={{ color: '#fff', fontWeight: '900' }}>{isSelected ? '✓' : ''}</Text>
                  </Pressable>
                ) : null}
              </View>
              <Text style={[styles.muted, { marginTop: 4 }]}>
                {t.label} · {departmentLabel[e.department_code]}{e.location ? ` · 📍 ${e.location}` : ''}
              </Text>
              {e.form_title_ar ? <Text style={styles.muted}>📋 {e.form_title_ar}</Text> : null}
              <View style={[styles.row, { marginTop: 6, flexWrap: 'wrap' }]}>
                <Badge text={st.label} color={st.color} />
                <TodayBadge e={e} />
                <MaintenanceBadge e={e} />
                {e.has_device_key ? <Badge text="🔌 مجس آلي" color={colors.primary} /> : null}
              </View>
            </Card>
          </Pressable>
        );
      }}
    />
  );
}
