import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import type { Department, FormTemplateSummary, MonitoringRecord } from '@/api/types';
import { Badge, Card, Chips, Empty, OfflineNote, styles } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { colors, departmentLabel } from '@/theme';

const DEPARTMENTS: Department[] = ['SUPPORT', 'HOT', 'COLD', 'SWEETS'];

/** Filled forms of a department, newest first (amended records are flagged). */
export default function RecordsScreen() {
  const params = useLocalSearchParams<{ templateId?: string; department?: Department; equipmentId?: string; title?: string }>();
  const { user } = useAuth();
  const [department, setDepartment] = useState<Department>(user?.department_code ?? params.department ?? 'SUPPORT');
  const [status, setStatus] = useState<'ALL' | 'PASS' | 'FAIL'>('ALL');
  const [templateId, setTemplateId] = useState<string>(params.templateId ?? 'ALL');
  const { data: templates } = useApi<FormTemplateSummary[]>('/haccp/templates');
  const q = new URLSearchParams({
    pageSize: '100', ...(status !== 'ALL' ? { status } : {}), ...(templateId !== 'ALL' ? { templateId } : {}),
    ...(params.equipmentId ? { equipmentId: params.equipmentId } : {}),
  });
  const { data, error, loading, offline, reload } = useApi<MonitoringRecord[]>(`/kitchens/${department.toLowerCase()}/records?${q}`);
  const forms = (templates ?? []).filter((t) => !t.department_code || t.department_code === department);

  return (
    <FlatList
      contentContainerStyle={styles.page}
      data={data ?? []}
      keyExtractor={(r) => r.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      ListHeaderComponent={
        <View>
          <OfflineNote show={offline} />
          {params.equipmentId ? <Text style={[styles.title, { marginBottom: 8 }]}>📟 سجلات الجهاز {params.title ?? ''}</Text> : null}
          {!user?.department_code ? (
            <Chips value={department} onChange={(d) => { setDepartment(d); setTemplateId('ALL'); }}
              options={DEPARTMENTS.map((d) => ({ value: d, label: departmentLabel[d] }))} />
          ) : null}
          <Chips value={status} onChange={setStatus} options={[
            { value: 'ALL', label: 'الكل' }, { value: 'PASS', label: 'مطابق', color: colors.success }, { value: 'FAIL', label: 'انحراف', color: colors.danger },
          ]} />
          <Chips value={templateId} onChange={setTemplateId}
            options={[{ value: 'ALL', label: 'كل النماذج' }, ...forms.map((t) => ({ value: t.id, label: t.title_ar }))]} />
          {error ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={loading ? undefined : <Empty text="لا توجد سجلات" />}
      renderItem={({ item }) => (
        <Pressable onPress={() => router.push({ pathname: '/records/[id]', params: { id: item.id, department } })}>
          <Card style={{ borderRightWidth: 4, borderRightColor: item.status === 'PASS' ? colors.success : colors.danger, paddingVertical: 12 }}>
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Text style={[styles.body, { fontWeight: '700', flex: 1 }]}>{item.template_title_ar}</Text>
              <Badge text={item.status === 'PASS' ? 'مطابق' : 'انحراف'} color={item.status === 'PASS' ? colors.success : colors.danger} />
            </View>
            <Text style={styles.muted}>
              {new Date(item.recorded_at).toLocaleString('ar-SA')} · {item.recorded_by_name} ({item.recorded_by_employee_no})
              {item.equipment_code ? ` · ${item.equipment_code}` : ''}
            </Text>
            {item.revision > 1 ? <Text style={[styles.muted, { color: colors.warning }]}>✏️ معدّل (الإصدار {item.revision}) — {item.amended_by_name}</Text> : null}
          </Card>
        </Pressable>
      )}
    />
  );
}
