import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { api, ApiError, errorMessage } from '@/api/client';
import type { Department, FormField, MonitoringRecord, ResolvedForm, ResolvedLabel } from '@/api/types';
import { Badge, Button, Card, Empty, Input, Loading, styles } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { cacheForm, cachedForm, enqueue, newClientRef } from '@/offline';
import { colors, departmentLabel, textStart } from '@/theme';

type Value = string | boolean | undefined;

const today = () => new Date().toISOString().slice(0, 10);
const nowTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const minutesBetween = (from: string, to: string) => {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return (m(to) - m(from) + 1440) % 1440;
};
const isTime = (v: Value): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** Live check against the (CCP) critical limits returned by the API — mirrors the server rules. */
function deviates(field: FormField, raw: Value, values: Record<string, Value>): boolean {
  if (field.type === 'number' && typeof raw === 'string' && raw.trim() !== '') {
    const v = Number(raw.replace(',', '.'));
    if (Number.isNaN(v)) return false;
    return (field.min !== undefined && v < field.min) || (field.max !== undefined && v > field.max);
  }
  if (field.type === 'boolean') return field.expected !== undefined && raw !== undefined && raw !== field.expected;
  if (field.type === 'time' && field.durationFrom && field.maxMinutes && isTime(raw)) {
    const start = values[field.durationFrom];
    return isTime(start) && minutesBetween(start, raw) > field.maxMinutes;
  }
  return false;
}

function Chip({ label, selected, onPress, color = colors.primary }: { label: string; selected: boolean; onPress: () => void; color?: string }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1, minWidth: 90, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, alignItems: 'center',
        borderColor: selected ? color : colors.border, backgroundColor: selected ? `${color}1A` : '#fff',
      }}
    >
      <Text style={{ fontWeight: '700', color: selected ? color : colors.text }}>{label}</Text>
    </Pressable>
  );
}

function FieldInput({ field, value, values, onChange }: {
  field: FormField; value: Value; values: Record<string, Value>; onChange: (v: Value) => void;
}) {
  const label = `${field.labelAr}${field.unit ? ` (${field.unit})` : ''}${field.required || field.ccpMeasurement ? ' *' : ''}`;
  const bad = deviates(field, value, values);

  if (field.type === 'boolean') {
    return (
      <View style={{ marginBottom: 14 }}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.row}>
          <Chip label="نعم" selected={value === true} onPress={() => onChange(true)} color={field.expected === false ? colors.danger : colors.success} />
          <Chip label="لا" selected={value === false} onPress={() => onChange(false)} color={field.expected === true ? colors.danger : colors.success} />
        </View>
        {bad ? <Text style={[styles.hint, { color: colors.danger }]}>إجابة غير مطابقة — سيتم فتح إجراء تصحيحي</Text> : null}
      </View>
    );
  }

  if (field.type === 'select') {
    return (
      <View style={{ marginBottom: 14 }}>
        <Text style={styles.label}>{label}</Text>
        <View style={[styles.row, { flexWrap: 'wrap' }]}>
          {field.options?.map((o) => <Chip key={o} label={o} selected={value === o} onPress={() => onChange(o)} />)}
        </View>
      </View>
    );
  }

  if (field.type === 'time') {
    const start = field.durationFrom ? values[field.durationFrom] : undefined;
    const elapsed = field.durationFrom && isTime(start) && isTime(value) ? minutesBetween(start, value) : null;
    return (
      <View style={{ marginBottom: 14 }}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Input value={typeof value === 'string' ? value : ''} onChangeText={onChange} placeholder="HH:MM" error={bad}
              keyboardType="numbers-and-punctuation" style={{ marginBottom: -14 }} />
          </View>
          <Pressable onPress={() => onChange(nowTime())} style={{ paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, backgroundColor: colors.primaryLight }}>
            <Text style={{ color: colors.primary, fontWeight: '700' }}>الآن</Text>
          </Pressable>
        </View>
        {field.limitText || elapsed !== null ? (
          <Text style={[styles.hint, bad && { color: colors.danger }]}>
            {elapsed !== null ? `المدة: ${Math.floor(elapsed / 60)} س ${elapsed % 60} د · ` : ''}{field.limitText ?? ''}{bad ? ' — تجاوز الحد!' : ''}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <Input
      label={label}
      value={typeof value === 'string' ? value : ''}
      onChangeText={onChange}
      keyboardType={field.type === 'number' ? 'numbers-and-punctuation' : 'default'}
      placeholder={field.type === 'date' ? 'YYYY-MM-DD' : field.limitText ?? ''}
      error={bad}
      hint={bad ? `⚠ خارج الحد الحرج (${field.limitText})` : field.limitText ? `الحد الحرج: ${field.limitText}` : undefined}
      style={field.ccpMeasurement ? { fontSize: 22, fontWeight: '800' } : undefined}
    />
  );
}

export default function FormScreen() {
  const { payload, source } = useLocalSearchParams<{ payload: string; source?: string }>();
  const { user, can } = useAuth();
  const [form, setForm] = useState<ResolvedForm | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [values, setValues] = useState<Record<string, Value>>({});
  const [batchNo, setBatchNo] = useState('');
  const [notes, setNotes] = useState('');
  const [actionTaken, setActionTaken] = useState('');
  const [department, setDepartment] = useState<Department | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MonitoringRecord | null>(null);
  const [queued, setQueued] = useState(false);
  // One id per filled form: a retried or replayed submission is never recorded twice.
  const clientRef = useMemo(() => newClientRef(), []);

  useEffect(() => {
    (async () => {
      let f: ResolvedForm | ResolvedLabel | undefined;
      try {
        f = await api<ResolvedForm | ResolvedLabel>('/qr/resolve', { method: 'POST', body: { payload } });
        if (f.kind !== 'LABEL') await cacheForm(payload, f);
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) {
          f = await cachedForm<ResolvedForm>(payload);
          setFromCache(!!f);
        }
        if (!f) return setLoadError(errorMessage(e));
      }
      if (f.kind === 'LABEL') {
        router.replace({ pathname: '/labels/[id]', params: { id: f.label.id } });
        return;
      }
      setForm(f);
      setDepartment(f.department ?? user?.department_code ?? null);
      const initial: Record<string, Value> = {};
      f.template.fields.forEach((fld) => {
        if (fld.type === 'date') initial[fld.key] = today();
      });
      setValues(initial);
    })();
  }, [payload, user]);

  const missing = useMemo(
    () => form?.template.fields.filter((f) => (f.required || f.ccpMeasurement) && (values[f.key] === undefined || values[f.key] === '')) ?? [],
    [form, values],
  );
  const hasDeviation = useMemo(() => !!form?.template.fields.some((f) => deviates(f, values[f.key], values)), [form, values]);

  const submit = async () => {
    if (!form || !department) return;
    setSubmitError(null);
    const data: Record<string, unknown> = {};
    for (const f of form.template.fields) {
      const v = values[f.key];
      if (v === undefined || v === '') continue;
      if (f.type === 'number') {
        const n = Number(String(v).replace(',', '.'));
        if (Number.isNaN(n)) return setSubmitError(`${f.labelAr}: قيمة رقمية غير صحيحة`);
        data[f.key] = n;
      } else if (f.type === 'time' && !isTime(v)) {
        return setSubmitError(`${f.labelAr}: أدخل الوقت بصيغة HH:MM`);
      } else {
        data[f.key] = typeof v === 'string' ? v.trim() : v;
      }
    }
    const productField = form.template.fields.find((f) => f.key === 'product' || f.key === 'produce');
    const body = {
      templateId: form.template.id,
      equipmentId: form.equipment?.id,
      data,
      productName: productField ? data[productField.key] : undefined,
      batchNo: batchNo || undefined,
      notes: notes || undefined,
      correctiveActionTaken: actionTaken.trim() || undefined,
      source: source === 'MANUAL' ? 'MANUAL' : 'QR',
      clientRef,
    };
    setBusy(true);
    try {
      setResult(await api<MonitoringRecord>(`/kitchens/${department.toLowerCase()}/records`, { method: 'POST', body }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        // No connection: keep the reading with its real time and send it later automatically.
        await enqueue({ clientRef, department, title: form.template.titleAr, queuedAt: new Date().toISOString(),
          body: { ...body, recordedAt: new Date().toISOString() } });
        setQueued(true);
      } else {
        setSubmitError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <View style={{ flex: 1, padding: 16 }}>
        <Empty text={loadError} />
        <Button title="رجوع" variant="outline" onPress={() => router.back()} />
      </View>
    );
  }
  if (!form) return <Loading />;

  if (queued) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Card style={{ backgroundColor: colors.warningLight, borderColor: colors.warning }}>
          <Text style={{ fontSize: 44, textAlign: 'center' }}>📥</Text>
          <Text style={[styles.title, { textAlign: 'center', color: colors.warning }]}>حُفظ السجل على الجهاز (دون اتصال)</Text>
          <Text style={[styles.body, { textAlign: 'center', marginTop: 8 }]}>
            سيُرسل تلقائياً بوقت القياس الفعلي فور عودة الاتصال، وتُفتح الإجراءات التصحيحية عندها إن وُجد انحراف.
          </Text>
          {hasDeviation ? (
            <Text style={[styles.body, { color: colors.danger, fontWeight: '700', marginTop: 10, textAlign: 'center' }]}>
              ⚠ القراءة خارج الحد الحرج — بلّغ مشرفك الآن ونفّذ الإجراء الفوري.
            </Text>
          ) : null}
        </Card>
        {hasDeviation && form.ccp ? (
          <Card>
            <Text style={styles.title}>الإجراء الفوري المطلوب</Text>
            <Text style={styles.body}>{form.ccp.correctiveAction}</Text>
          </Card>
        ) : null}
        <Button title="تم" onPress={() => router.back()} />
      </ScrollView>
    );
  }

  if (result) {
    const pass = result.status === 'PASS';
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Stack.Screen options={{ title: form.template.titleAr }} />
        <Card style={{ backgroundColor: pass ? colors.successLight : colors.dangerLight, borderColor: pass ? colors.success : colors.danger }}>
          <Text style={{ fontSize: 48, textAlign: 'center' }}>{pass ? '✅' : '⛔'}</Text>
          <Text style={[styles.title, { textAlign: 'center', color: pass ? colors.success : colors.danger }]}>
            {pass ? 'مطابق — تم حفظ السجل' : 'انحراف عن الحد الحرج!'}
          </Text>
          {!pass ? (
            <>
              {result.deviations.map((d) => (
                <Text key={d.field} style={[styles.body, { marginTop: 8 }]}>
                  • {d.label}: {String(d.value)} (الحد: {d.limit})
                </Text>
              ))}
              <Text style={[styles.body, { marginTop: 12, fontWeight: '700' }]}>تم إرسال تنبيه فوري للمشرف ومسؤول الهاسب وفتح إجراء تصحيحي (CAPA).</Text>
            </>
          ) : null}
        </Card>
        {!pass && form.ccp ? (
          <Card>
            <Text style={styles.title}>الإجراء الفوري المطلوب</Text>
            <Text style={styles.body}>{form.ccp.correctiveAction}</Text>
          </Card>
        ) : null}
        {!pass && result.capa_id && can('capa:update') ? (
          <Button title="فتح الإجراء التصحيحي" variant="danger" onPress={() => router.replace({ pathname: '/capa/[id]', params: { id: result.capa_id! } })} />
        ) : null}
        <Button title="تم" onPress={() => router.back()} />
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: form.template.titleAr }} />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {fromCache ? (
          <Card style={{ backgroundColor: colors.warningLight, borderColor: colors.warning }}>
            <Text style={[styles.body, { color: colors.warning, fontWeight: '700' }]}>📴 لا يوجد اتصال — النموذج من الذاكرة وسيُحفظ السجل على الجهاز ويُرسل لاحقاً.</Text>
          </Card>
        ) : null}
        <Card>
          <Text style={styles.title}>{form.template.titleAr}</Text>
          <Text style={styles.muted}>
            {form.template.code} · v{form.template.version}
            {department ? ` · ${departmentLabel[department]}` : ''}
          </Text>
          {form.equipment ? (
            <Text style={[styles.body, { marginTop: 6 }]}>
              الجهاز: {form.equipment.code} — {form.equipment.name} {form.equipment.location ? `(${form.equipment.location})` : ''}
            </Text>
          ) : null}
          {form.ccp ? (
            <View style={{ marginTop: 10 }}>
              <Badge text={`${form.ccp.code} · الحد الحرج ${form.ccp.criticalLimit}`} color={colors.danger} />
              <Text style={[styles.muted, { marginTop: 6 }]}>الخطر: {form.ccp.hazard}</Text>
            </View>
          ) : null}
        </Card>

        {!form.department && !user?.department_code ? (
          <Card>
            <Text style={styles.label}>القسم *</Text>
            <View style={[styles.row, { flexWrap: 'wrap' }]}>
              {(['HOT', 'COLD', 'SWEETS', 'SUPPORT'] as Department[]).map((d) => (
                <Chip key={d} label={departmentLabel[d]} selected={department === d} onPress={() => setDepartment(d)} />
              ))}
            </View>
          </Card>
        ) : null}

        <Card>
          {form.template.fields.map((f) => (
            <FieldInput key={f.key} field={f} value={values[f.key]} values={values}
              onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
          ))}
          {hasDeviation ? (
            <View style={{ backgroundColor: colors.dangerLight, borderRadius: 12, padding: 12, marginBottom: 14 }}>
              <Text style={[styles.label, { color: colors.danger }]}>⚠ يوجد انحراف — ما الإجراء الذي اتخذته فوراً؟</Text>
              {form.ccp ? <Text style={[styles.hint, { marginBottom: 8 }]}>الإجراء المعتمد: {form.ccp.correctiveAction}</Text> : null}
              <Input value={actionTaken} onChangeText={setActionTaken} multiline placeholder="مثال: أعدت الطهي حتى 78°م ثم أعدت القياس"
                style={{ minHeight: 60 }} />
            </View>
          ) : null}
          <Input label="رقم الدفعة (اختياري)" value={batchNo} onChangeText={setBatchNo} />
          <Input label="ملاحظات (اختياري)" value={notes} onChangeText={setNotes} multiline style={{ minHeight: 70 }} />
        </Card>

        {submitError ? <Text style={{ color: colors.danger, marginBottom: 8, textAlign: textStart }}>{submitError}</Text> : null}
        <Button title="حفظ السجل" onPress={submit} loading={busy} disabled={missing.length > 0 || !department} />
        {missing.length > 0 ? <Text style={[styles.muted, { textAlign: 'center' }]}>أكمل الحقول الإلزامية ({missing.length})</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
