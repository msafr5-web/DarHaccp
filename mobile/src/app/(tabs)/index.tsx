import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import type { MonitoringRecord, Overview } from '@/api/types';
import { Badge, Button, Card, Stat, styles } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { colors, departmentLabel, roleLabel } from '@/theme';

const rateColor = (rate: number | null) =>
  rate === null ? colors.muted : rate >= 95 ? colors.success : rate >= 85 ? colors.warning : colors.danger;

export default function HomeScreen() {
  const { user, signOut, can } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [records, setRecords] = useState<MonitoringRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      if (can('dashboard')) setOverview(await api<Overview>('/dashboard/overview'));
      if (user?.department_code) {
        setRecords(await api<MonitoringRecord[]>(`/kitchens/${user.department_code.toLowerCase()}/records?pageSize=10`));
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [can, user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <Card>
        <Text style={styles.title}>مرحباً، {user?.full_name}</Text>
        <Text style={styles.muted}>
          {roleLabel[user?.role ?? '']} {user?.department_code ? `· ${departmentLabel[user.department_code]}` : '· جميع الأقسام'}
        </Text>
      </Card>

      {error ? <Text style={{ color: colors.danger, marginBottom: 12, textAlign: 'left' }}>{error}</Text> : null}

      {overview ? (
        <>
          <Card>
            <Text style={styles.title}>نسبة الامتثال اليوم</Text>
            <Text style={{ fontSize: 44, fontWeight: '900', color: rateColor(overview.compliance.complianceRate), textAlign: 'left' }}>
              {overview.compliance.complianceRate ?? '—'}%
            </Text>
            <View style={styles.row}>
              <Stat label="سجلات" value={overview.compliance.total} />
              <Stat label="مطابق" value={overview.compliance.passed} color={colors.success} />
              <Stat label="انحرافات" value={overview.deviationsToday} color={colors.danger} />
            </View>
            {overview.compliance.byDepartment.map((d) => (
              <View key={d.code} style={[styles.row, { justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderColor: '#F2F4F7' }]}>
                <Text style={styles.body}>{d.name_ar}</Text>
                <Text style={{ fontWeight: '700', color: rateColor(d.complianceRate) }}>
                  {d.complianceRate ?? '—'}% ({d.passed}/{d.total})
                </Text>
              </View>
            ))}
          </Card>

          <Card>
            <Text style={styles.title}>الإجراءات التصحيحية والتنبيهات</Text>
            <View style={styles.row}>
              <Stat label="تنبيهات مفتوحة" value={overview.openAlerts.total} color={colors.danger} />
              <Stat label="CAPA مفتوحة" value={overview.capas.open + overview.capas.in_progress} color={colors.warning} />
              <Stat label="CAPA متأخرة" value={overview.capas.overdue} color={colors.danger} />
            </View>
          </Card>

          <Card>
            <Text style={styles.title}>الشهادات الصحية</Text>
            <View style={styles.row}>
              <Stat label="سارية" value={overview.healthCertificates.valid} color={colors.success} />
              <Stat label={`تنتهي خلال ${overview.healthCertificates.warningDays} يوم`} value={overview.healthCertificates.expiring_soon} color={colors.warning} />
              <Stat label="منتهية" value={overview.healthCertificates.expired} color={colors.danger} />
            </View>
          </Card>

          <Card>
            <Text style={styles.title}>حالة الأجهزة والصيانة</Text>
            <View style={styles.row}>
              <Stat label="تعمل" value={overview.equipment.operational} color={colors.success} />
              <Stat label="تحت الصيانة" value={overview.equipment.under_maintenance} color={colors.warning} />
              <Stat label="صيانة متأخرة" value={overview.equipment.maintenance_overdue} color={colors.danger} />
            </View>
          </Card>
        </>
      ) : null}

      {user?.department_code ? (
        <Card>
          <Text style={[styles.title, { marginBottom: 8 }]}>آخر السجلات — {departmentLabel[user.department_code]}</Text>
          {records.length === 0 ? <Text style={styles.muted}>لا توجد سجلات بعد</Text> : null}
          {records.map((r) => (
            <View key={r.id} style={{ paddingVertical: 8, borderTopWidth: 1, borderColor: '#F2F4F7' }}>
              <View style={[styles.row, { justifyContent: 'space-between' }]}>
                <Text style={[styles.body, { fontWeight: '600', flex: 1 }]}>{r.template_title_ar}</Text>
                <Badge text={r.status === 'PASS' ? 'مطابق' : 'انحراف'} color={r.status === 'PASS' ? colors.success : colors.danger} />
              </View>
              <Text style={styles.muted}>
                {r.measured_value !== null ? `${r.measured_value} ${r.unit ?? ''} · ` : ''}
                {r.recorded_by_name} · {new Date(r.recorded_at).toLocaleString('ar-SA')}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      <Button title="تسجيل الخروج" variant="outline" onPress={signOut} />
    </ScrollView>
  );
}
