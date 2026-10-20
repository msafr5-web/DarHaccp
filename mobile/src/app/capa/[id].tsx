import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import type { Capa } from '@/api/types';
import { Badge, Button, Card, Input, Loading, styles } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { colors, departmentLabel } from '@/theme';

const DISPOSITIONS: { value: string; label: string }[] = [
  { value: 'RECOOK', label: 'إعادة الطهي' },
  { value: 'REHEAT', label: 'إعادة التسخين' },
  { value: 'RECHILL', label: 'إعادة التبريد' },
  { value: 'HOLD', label: 'حجز المنتج' },
  { value: 'DISCARD', label: 'إتلاف' },
  { value: 'RETURN_TO_SUPPLIER', label: 'إرجاع للمورد' },
  { value: 'RELEASE', label: 'إطلاق' },
];

export default function CapaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, can } = useAuth();
  const [capa, setCapa] = useState<Capa | null>(null);
  const [rootCause, setRootCause] = useState('');
  const [corrective, setCorrective] = useState('');
  const [preventive, setPreventive] = useState('');
  const [disposition, setDisposition] = useState<string | undefined>();
  const [verification, setVerification] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = useCallback((c: Capa) => {
    setCapa(c);
    setRootCause(c.root_cause ?? '');
    setCorrective(c.corrective_action ?? '');
    setPreventive(c.preventive_action ?? '');
    setDisposition(c.product_disposition ?? undefined);
  }, []);

  useEffect(() => {
    api<Capa>(`/capas/${id}`).then(apply).catch((e) => Alert.alert('خطأ', errorMessage(e)));
  }, [id, apply]);

  const run = async (path: string, body: object, done: string) => {
    setBusy(true);
    try {
      apply(await api<Capa>(path, { method: path.endsWith(id) ? 'PATCH' : 'POST', body }));
      Alert.alert('تم', done);
    } catch (e) {
      Alert.alert('تعذر الحفظ', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!capa) return <Loading />;
  const editable = can('capa:update') && (capa.status === 'OPEN' || capa.status === 'IN_PROGRESS');
  const fields = { rootCause, correctiveAction: corrective, preventiveAction: preventive, productDisposition: disposition };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Card>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text style={styles.title}>{capa.capa_no}</Text>
          <Badge text={capa.status} color={capa.status === 'VERIFIED' ? colors.success : capa.status === 'CLOSED' ? colors.primary : colors.danger} />
        </View>
        <Text style={styles.muted}>
          {departmentLabel[capa.department_code]} {capa.ccp_code ? `· ${capa.ccp_code}` : ''} · المسؤول: {capa.assigned_to_name ?? '—'}
          {capa.due_date ? ` · الاستحقاق: ${capa.due_date}` : ''}
        </Text>
        <Text style={[styles.body, { marginTop: 8 }]}>{capa.description}</Text>
        {capa.immediate_action ? (
          <Text style={[styles.body, { marginTop: 8, color: colors.danger }]}>الإجراء الفوري: {capa.immediate_action}</Text>
        ) : null}
      </Card>

      <Card>
        <Input label="السبب الجذري *" value={rootCause} onChangeText={setRootCause} editable={editable} multiline />
        <Input label="الإجراء التصحيحي المتخذ *" value={corrective} onChangeText={setCorrective} editable={editable} multiline />
        <Input label="الإجراء الوقائي" value={preventive} onChangeText={setPreventive} editable={editable} multiline />
        <Text style={styles.label}>قرار المنتج</Text>
        <View style={[styles.row, { flexWrap: 'wrap' }]}>
          {DISPOSITIONS.map((d) => (
            <Pressable
              key={d.value}
              disabled={!editable}
              onPress={() => setDisposition(d.value)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 999,
                borderWidth: 1.5,
                borderColor: disposition === d.value ? colors.primary : colors.border,
                backgroundColor: disposition === d.value ? colors.primaryLight : '#fff',
              }}
            >
              <Text style={{ color: colors.text, fontWeight: '600' }}>{d.label}</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      {editable ? (
        <>
          <Button title="حفظ (قيد المعالجة)" variant="outline" loading={busy} onPress={() => run(`/capas/${id}`, fields, 'تم حفظ التحديث')} />
          <Button
            title="إغلاق الإجراء التصحيحي"
            loading={busy}
            disabled={!rootCause.trim() || !corrective.trim()}
            onPress={() => run(`/capas/${id}/close`, fields, 'تم الإغلاق — بانتظار تحقق مسؤول الهاسب')}
          />
        </>
      ) : null}

      {capa.status === 'CLOSED' && can('capa:verify') && capa.closed_by !== user?.id ? (
        <Card>
          <Text style={styles.title}>التحقق (HACCP Verification)</Text>
          <Input label="ملاحظات التحقق *" value={verification} onChangeText={setVerification} multiline />
          <Button
            title="اعتماد التحقق"
            loading={busy}
            disabled={verification.trim().length < 5}
            onPress={() => run(`/capas/${id}/verify`, { verificationNotes: verification }, 'تم اعتماد الإجراء التصحيحي')}
          />
        </Card>
      ) : null}

      {capa.verification_notes ? (
        <Card>
          <Text style={styles.title}>ملاحظات التحقق</Text>
          <Text style={styles.body}>{capa.verification_notes}</Text>
        </Card>
      ) : null}
    </ScrollView>
  );
}
