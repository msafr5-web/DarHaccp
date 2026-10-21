import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import type { Incident } from '@/api/types';
import { Badge, Button, Card, Empty, Loading, styles } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { departmentLabel, severityColor } from '@/theme';
import { INCIDENT_STATUS, incidentTypeLabel as typeLabel } from '@/constants';

export default function IncidentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useAuth();
  const { data: incident, error } = useApi<Incident>(`/incidents/${id}`);

  if (error) return <Empty text={error} />;
  if (!incident) return <Loading />;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Card>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text style={styles.title}>{incident.incident_no}</Text>
          <Badge text={INCIDENT_STATUS[incident.status].label} color={INCIDENT_STATUS[incident.status].color} />
        </View>
        <Text style={[styles.title, { fontSize: 16, marginTop: 8 }]}>{incident.title}</Text>
        <View style={[styles.row, { marginVertical: 8 }]}>
          <Badge text={typeLabel(incident.type)} color={severityColor.MEDIUM} />
          <Badge text={incident.severity} color={severityColor[incident.severity]} />
        </View>
        <Text style={styles.body}>{incident.description}</Text>
        <Text style={[styles.muted, { marginTop: 8 }]}>
          {departmentLabel[incident.department_code]}{incident.location ? ` · ${incident.location}` : ''} · {new Date(incident.occurred_at).toLocaleString('ar-SA')}
        </Text>
        <Text style={styles.muted}>المُبلِّغ: {incident.reported_by_name} · المسؤول: {incident.assigned_to_name ?? '—'}</Text>
        {incident.audit_no ? <Text style={styles.muted}>مصدره التدقيق الداخلي {incident.audit_no}</Text> : null}
      </Card>

      {incident.root_cause ? (
        <Card>
          <Text style={styles.title}>نتيجة التحقيق</Text>
          <Text style={[styles.body, { marginTop: 6 }]}>السبب الجذري: {incident.root_cause}</Text>
          <Text style={[styles.body, { marginTop: 6 }]}>الإجراء التصحيحي: {incident.corrective_action}</Text>
        </Card>
      ) : null}

      {incident.capa_id && can('capa:update') ? (
        <Button
          title={`فتح الإجراء التصحيحي ${incident.capa_no ?? ''}`}
          variant={incident.status === 'CLOSED' ? 'outline' : 'danger'}
          onPress={() => router.push({ pathname: '/capa/[id]', params: { id: incident.capa_id! } })}
        />
      ) : null}
    </ScrollView>
  );
}
