import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import type { FormField, MonitoringRecord, RecordRevision } from '@/api/types';
import { AnswerRow, FieldInput } from '@/components/FormFields';
import { Badge, Button, Card, Empty, Input, Loading, styles } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { computeValues, toPayload, Values } from '@/formLogic';
import { colors, roleLabel, textStart } from '@/theme';

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={[styles.row, { justifyContent: 'space-between', paddingVertical: 6 }]}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={[styles.body, { fontWeight: '700', flexShrink: 1 }]} selectable>{value}</Text>
    </View>
  );
}

const CROSS = ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER'];

/** A filled form as legal evidence: who, where, which device, when — and every amendment with its reason. */
export default function RecordScreen() {
  const { id, department } = useLocalSearchParams<{ id: string; department: string }>();
  const dept = String(department ?? '').toLowerCase();
  const { user } = useAuth();
  const { data: r, error, setData, reload } = useApi<MonitoringRecord>(`/kitchens/${dept}/records/${id}`);
  const { data: revisions, reload: reloadRevisions } = useApi<RecordRevision[]>(`/kitchens/${dept}/records/${id}/revisions`);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Values>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const fields = (r?.template_fields ?? []) as FormField[];
  const computed = useMemo(() => computeValues(fields, values), [fields, values]);

  if (error) return <Empty text={error} />;
  if (!r || !user) return <Loading />;

  const deviating = new Set(r.deviations.map((d) => d.field));
  const fillEdit = user.role === 'ADMIN' || user.record_access === 'FILL_EDIT';
  const ownOrCross = CROSS.includes(user.role) || r.recorded_by === user.id;
  const formChanged = r.template_current_version !== undefined && r.template_current_version !== r.template_version;
  const stockRecord = fields.some((f) => f.stock);
  const canEdit = fillEdit && ownOrCross && r.source !== 'IOT' && !formChanged && !stockRecord;

  const startEdit = () => {
    const v: Values = {};
    for (const f of fields) {
      const x = r.data[f.key];
      v[f.key] = typeof x === 'number' ? String(x) : (x as Values[string]);
    }
    setValues(v);
    setReason('');
    setMessage(null);
    setEditing(true);
  };

  const save = async () => {
    const { data, error: err } = toPayload(fields, values);
    if (err) return setMessage({ text: err, ok: false });
    setBusy(true);
    setMessage(null);
    try {
      const updated = await api<MonitoringRecord>(`/kitchens/${dept}/records/${id}`, { method: 'PATCH', body: { data, reason: reason.trim() } });
      setData({ ...r, ...updated });
      setEditing(false);
      setMessage({ text: `تم حفظ التعديل — الإصدار ${updated.revision}، والنسخة السابقة محفوظة في السجل`, ok: true });
      void reload();
      void reloadRevisions();
    } catch (e) {
      setMessage({ text: errorMessage(e), ok: false });
    } finally {
      setBusy(false);
    }
  };

  const pass = r.status === 'PASS';
  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Card style={{ borderRightWidth: 5, borderRightColor: pass ? colors.success : colors.danger }}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text style={[styles.title, { flex: 1 }]}>{r.template_title_ar}</Text>
          <Badge text={pass ? 'مطابق' : 'انحراف'} color={pass ? colors.success : colors.danger} />
        </View>
        <Text style={styles.muted}>رقم السجل {r.id.slice(0, 8).toUpperCase()} · {r.template_code} · v{r.template_version}</Text>
      </Card>

      <Card style={{ backgroundColor: '#F8FBF9' }}>
        <Row label="🏢 الشركة" value={r.company_name} />
        <Row label="📍 الموقع" value={[r.equipment_location, r.branch_name].filter(Boolean).join(' — ')} />
        <Row label="🔖 رقم الجهاز" value={[r.equipment_code && `${r.equipment_code}${r.equipment_name ? ` (${r.equipment_name})` : ''}`, r.device_info].filter(Boolean).join(' · ')} />
        <Row label="🕒 وقت التعبئة" value={new Date(r.recorded_at).toLocaleString('ar-SA')} />
        <Row label="👤 الموظف" value={`${r.recorded_by_name} · ${r.recorded_by_employee_no} · ${roleLabel[r.recorded_by_role] ?? r.recorded_by_role}`} />
        <Row label="📲 المصدر" value={r.source === 'QR' ? 'مسح رمز QR' : r.source === 'IOT' ? 'مجس آلي' : 'إدخال يدوي'} />
        {r.revision > 1 ? (
          <Row label="✏️ آخر تعديل" value={`${r.amended_by_name ?? ''} · ${r.amended_at ? new Date(r.amended_at).toLocaleString('ar-SA') : ''} — ${r.amendment_reason ?? ''}`} />
        ) : null}
      </Card>

      {message ? <Text style={{ color: message.ok ? colors.success : colors.danger, marginBottom: 8, textAlign: textStart }}>{message.text}</Text> : null}

      {editing ? (
        <Card style={{ borderColor: colors.primary }}>
          <Text style={styles.title}>تعديل السجل</Text>
          <Text style={[styles.muted, { marginBottom: 10 }]}>تُعاد مطابقة القيم مع الحدود الحرجة، وتُحفظ النسخة الحالية في سجل التعديلات مع السبب.</Text>
          {fields.map((f) => (
            <FieldInput key={f.key} field={f} value={computed[f.key]} values={computed}
              locked={f.carryFrom && r.data[f.key] !== undefined ? 'carried' : undefined}
              onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
          ))}
          <Input label="سبب التعديل *" value={reason} onChangeText={setReason} multiline style={{ minHeight: 60 }}
            placeholder="مثال: خطأ في إدخال الكمية" />
          <View style={styles.row}>
            <View style={{ flex: 1 }}><Button title="حفظ التعديل" loading={busy} disabled={reason.trim().length < 5} onPress={save} /></View>
            <View style={{ flex: 1 }}><Button title="إلغاء" variant="outline" onPress={() => setEditing(false)} /></View>
          </View>
        </Card>
      ) : (
        <Card>
          {fields.length
            ? fields.map((f) => <AnswerRow key={f.key} field={f} value={r.data[f.key]} deviating={deviating.has(f.key)} />)
            : Object.entries(r.data).map(([k, v]) => <Row key={k} label={k} value={String(v)} />)}
          {r.notes ? <Row label="ملاحظات" value={r.notes} /> : null}
          {r.corrective_action_taken ? <Row label="الإجراء المتخذ" value={r.corrective_action_taken} /> : null}
        </Card>
      )}

      {r.ncr_id && !editing ? (
        <Button title={`📋 تقرير عدم المطابقة ${r.ncr_no ?? ''}`} variant="outline"
          onPress={() => router.push({ pathname: '/incidents/[id]', params: { id: r.ncr_id! } })} />
      ) : null}
      {!pass && !editing ? (
        <Card style={{ backgroundColor: colors.dangerLight }}>
          {r.deviations.map((d) => (
            <Text key={d.field} style={[styles.body, { marginBottom: 4 }]}>⚠ {d.label}: {String(d.value)} (الحد: {d.limit}){d.critical ? ' — حرج' : ''}</Text>
          ))}
          {r.capa_id ? <Button title="فتح الإجراء التصحيحي" variant="danger" onPress={() => router.push({ pathname: '/capa/[id]', params: { id: r.capa_id! } })} /> : null}
        </Card>
      ) : null}

      {!editing ? (
        canEdit ? <Button title="✏️ تعديل السجل" variant="outline" onPress={startEdit} />
          : (
            <Text style={[styles.muted, { textAlign: 'center', marginBottom: 12 }]}>
              {!fillEdit ? '📝 صلاحيتك تعبئة فقط — لا يمكنك تعديل السجلات'
                : r.source === 'IOT' ? 'قراءات المجسات الآلية لا تُعدَّل'
                : stockRecord ? 'حركات المخزون لا تُعدَّل (دفتر FEFO) — سجّل جرداً أو حركة تصحيحية'
                : formChanged ? 'تغيّرت حقول النموذج منذ تعبئة هذا السجل — لا يمكن تعديله'
                : 'يمكنك تعديل السجلات التي عبأتها أنت فقط'}
            </Text>
          )
      ) : null}

      {revisions?.length ? (
        <Card>
          <Text style={styles.title}>سجل التعديلات</Text>
          {revisions.map((v) => (
            <View key={v.revision} style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: '#F2F4F7' }}>
              <Text style={[styles.body, { fontWeight: '700' }]}>الإصدار {v.revision} — {v.status === 'PASS' ? 'مطابق' : 'انحراف'}</Text>
              <Text style={styles.muted}>عبأه {v.authored_by_name} · {new Date(v.authored_at).toLocaleString('ar-SA')}</Text>
              <Text style={styles.muted}>استُبدل بواسطة {v.superseded_by_name} · {new Date(v.superseded_at).toLocaleString('ar-SA')}</Text>
              <Text style={[styles.body, { color: colors.warning }]}>السبب: {v.reason}</Text>
              <Text style={[styles.muted, { fontSize: 12 }]}>
                {fields.filter((f) => JSON.stringify(v.data[f.key]) !== JSON.stringify(r.data[f.key]))
                  .map((f) => `${f.labelAr}: ${String(v.data[f.key] ?? '—')}`).join(' · ') || 'لا فرق في القيم'}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}
    </ScrollView>
  );
}
