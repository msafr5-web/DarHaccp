import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import type { Incident } from '@/api/types';
import { Badge, Button, Card, Chips, Empty, OfflineNote, styles } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { INCIDENT_STATUS, incidentTypeLabel as typeLabel } from '@/constants';
import { colors, departmentLabel, severityColor } from '@/theme';

export default function IncidentsScreen() {
  const [status, setStatus] = useState<'ALL' | keyof typeof INCIDENT_STATUS>('ALL');
  const { data, error, loading, offline, reload } = useApi<Incident[]>(`/incidents?pageSize=100${status !== 'ALL' ? `&status=${status}` : ''}`);

  return (
    <FlatList
      contentContainerStyle={styles.page}
      data={data ?? []}
      keyExtractor={(i) => i.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      ListHeaderComponent={
        <View>
          <OfflineNote show={offline} />
          <Button title="🚨 بلاغ جديد" onPress={() => router.push('/incidents/new')} />
          <View style={{ height: 10 }} />
          <Chips value={status} onChange={setStatus}
            options={[{ value: 'ALL', label: 'الكل' }, ...Object.entries(INCIDENT_STATUS).map(([value, s]) => ({ value: value as keyof typeof INCIDENT_STATUS, label: s.label, color: s.color }))]} />
          {error ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={loading ? undefined : <Empty text="لا توجد بلاغات" />}
      renderItem={({ item }) => (
        <Pressable onPress={() => router.push({ pathname: '/incidents/[id]', params: { id: item.id } })}>
          <Card style={{ borderRightWidth: 5, borderRightColor: severityColor[item.severity] }}>
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Text style={[styles.title, { fontSize: 15, flex: 1 }]}>{item.title}</Text>
              <Badge text={INCIDENT_STATUS[item.status].label} color={INCIDENT_STATUS[item.status].color} />
            </View>
            <Text style={styles.muted}>
              {item.incident_no} · {typeLabel(item.type)} · {departmentLabel[item.department_code]} · {new Date(item.occurred_at).toLocaleDateString('ar-SA')}
            </Text>
            {item.capa_no ? <Text style={styles.muted}>الإجراء التصحيحي: {item.capa_no} ({item.capa_status})</Text> : null}
          </Card>
        </Pressable>
      )}
    />
  );
}
