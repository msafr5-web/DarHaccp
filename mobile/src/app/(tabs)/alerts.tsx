import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert as RNAlert, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import type { Alert, Capa } from '@/api/types';
import { Badge, Button, Card, Empty, styles } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { colors, departmentLabel, severityColor } from '@/theme';

const capaStatus: Record<Capa['status'], { label: string; color: string }> = {
  OPEN: { label: 'مفتوح', color: colors.danger },
  IN_PROGRESS: { label: 'قيد المعالجة', color: colors.warning },
  CLOSED: { label: 'مغلق — بانتظار التحقق', color: colors.primary },
  VERIFIED: { label: 'تم التحقق', color: colors.success },
};

export default function AlertsScreen() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'alerts' | 'capas'>('alerts');
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [capas, setCapas] = useState<Capa[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showCapas = can('capa:update') || can('dashboard');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAlerts(await api<Alert[]>('/alerts?pageSize=50'));
      if (showCapas) setCapas(await api<Capa[]>('/capas?pageSize=50'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [showCapas]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const acknowledge = async (id: string) => {
    try {
      await api(`/alerts/${id}/acknowledge`, { method: 'POST' });
      await load();
    } catch (e) {
      RNAlert.alert('تعذر التنفيذ', errorMessage(e));
    }
  };

  const header = (
    <View>
      {showCapas ? (
        <View style={[styles.row, { marginBottom: 12 }]}>
          <View style={{ flex: 1 }}>
            <Button title="التنبيهات" variant={tab === 'alerts' ? 'primary' : 'outline'} onPress={() => setTab('alerts')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="الإجراءات التصحيحية" variant={tab === 'capas' ? 'primary' : 'outline'} onPress={() => setTab('capas')} />
          </View>
        </View>
      ) : null}
      {error ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text> : null}
    </View>
  );

  if (tab === 'capas') {
    return (
      <FlatList
        contentContainerStyle={styles.page}
        data={capas}
        keyExtractor={(c) => c.id}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={loading ? undefined : <Empty text="لا توجد إجراءات تصحيحية" />}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push({ pathname: '/capa/[id]', params: { id: item.id } })}>
            <Card>
              <View style={[styles.row, { justifyContent: 'space-between' }]}>
                <Text style={[styles.title, { fontSize: 15 }]}>{item.capa_no}</Text>
                <Badge text={capaStatus[item.status].label} color={capaStatus[item.status].color} />
              </View>
              <Text style={styles.body} numberOfLines={2}>{item.description}</Text>
              <Text style={styles.muted}>
                {departmentLabel[item.department_code]} {item.ccp_code ? `· ${item.ccp_code}` : ''} {item.due_date ? `· الاستحقاق ${item.due_date}` : ''}
              </Text>
            </Card>
          </Pressable>
        )}
      />
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.page}
      data={alerts}
      keyExtractor={(a) => a.id}
      ListHeaderComponent={header}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      ListEmptyComponent={loading ? undefined : <Empty text="لا توجد تنبيهات 👍" />}
      renderItem={({ item }) => (
        <Card style={{ borderRightWidth: 5, borderRightColor: severityColor[item.severity], opacity: item.status === 'RESOLVED' ? 0.6 : 1 }}>
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <Text style={[styles.title, { fontSize: 15, flex: 1 }]}>{item.title}</Text>
            <Badge text={item.severity} color={severityColor[item.severity]} />
          </View>
          <Text style={styles.body}>{item.message}</Text>
          <Text style={styles.muted}>
            {item.department_code ? departmentLabel[item.department_code] : 'عام'} · {new Date(item.created_at).toLocaleString('ar-SA')} · {item.status}
          </Text>
          {item.status === 'OPEN' && can('alert:manage') ? <Button title="استلام التنبيه" variant="outline" onPress={() => acknowledge(item.id)} /> : null}
        </Card>
      )}
    />
  );
}
