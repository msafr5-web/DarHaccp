import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import type { Department, InternalAudit } from '@/api/types';
import { Badge, Button, Card, Chips, Empty, Input, OfflineNote, styles } from '@/components/ui';
import { AUDIT_STANDARDS } from '@/constants';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { colors, departmentLabel, textStart } from '@/theme';

const DEPARTMENTS: Department[] = ['HOT', 'COLD', 'SWEETS', 'SUPPORT'];
const scoreColor = (s: number | null) => (s === null ? colors.muted : s >= 90 ? colors.success : s >= 75 ? colors.warning : colors.danger);

function PlanAudit({ onPlanned }: { onPlanned: () => void }) {
  const [open, setOpen] = useState(false);
  const [standard, setStandard] = useState<(typeof AUDIT_STANDARDS)[number]['value']>('HACCP_ISO22000');
  const [department, setDepartment] = useState<Department>('HOT');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return <Button title="📅 جدولة تدقيق داخلي" variant="outline" onPress={() => setOpen(true)} />;
  return (
    <Card>
      <Text style={styles.label}>المعيار</Text>
      <Chips options={AUDIT_STANDARDS} value={standard} onChange={setStandard} />
      <Text style={styles.label}>القسم</Text>
      <Chips options={DEPARTMENTS.map((d) => ({ value: d, label: departmentLabel[d] }))} value={department} onChange={setDepartment} />
      <Input label="التاريخ" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
      {error ? <Text style={{ color: colors.danger, textAlign: textStart }}>{error}</Text> : null}
      <Button
        title="حفظ الجدولة"
        loading={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await api('/internal-audits', { method: 'POST', body: { standard, department, scheduledDate: date } });
            setOpen(false);
            onPlanned();
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </Card>
  );
}

export default function AuditsScreen() {
  const { can } = useAuth();
  const { data, error, loading, offline, reload } = useApi<InternalAudit[]>('/internal-audits?pageSize=100');

  return (
    <FlatList
      contentContainerStyle={styles.page}
      data={data ?? []}
      keyExtractor={(a) => a.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      ListHeaderComponent={
        <View style={{ marginBottom: 6 }}>
          <OfflineNote show={offline} />
          {can('internal-audit:manage') ? <PlanAudit onPlanned={reload} /> : null}
          {error ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={loading ? undefined : <Empty text="لا توجد عمليات تدقيق" />}
      renderItem={({ item }) => (
        <Pressable onPress={() => router.push({ pathname: '/audits/[id]', params: { id: item.id } })}>
          <Card>
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Text style={[styles.title, { fontSize: 15, flex: 1 }]}>{item.title}</Text>
              {item.status === 'COMPLETED' ? (
                <Badge text={`${item.score}%`} color={scoreColor(item.score)} />
              ) : (
                <Badge text="مجدول" color={colors.primary} />
              )}
            </View>
            <Text style={styles.muted}>
              {item.audit_no} · {departmentLabel[item.department_code]} · المدقق: {item.auditor_name} · {item.scheduled_date}
            </Text>
            {item.status === 'COMPLETED' ? (
              <Text style={styles.muted}>الملاحظات: {item.findings} (مفتوحة {item.open_findings})</Text>
            ) : null}
          </Card>
        </Pressable>
      )}
    />
  );
}
