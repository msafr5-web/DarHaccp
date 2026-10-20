import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import type { Department, FormField, MonitoringRecord, ResolvedForm } from '@/api/types';
import { Badge, Button, Card, Empty, Input, Loading, styles } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { colors, departmentLabel, textStart } from '@/theme';

type Value = string | boolean | undefined;

const today = () => new Date().toISOString().slice(0, 10);

/** Live check of a numeric value against the (CCP) critical limits returned by the API. */
function outOfLimit(field: FormField, raw: Value): boolean {
  if (field.type !== 'number' || typeof raw !== 'string' || raw.trim() === '') return false;
  const v = Number(raw.replace(',', '.'));
  if (Number.isNaN(v)) return false;
  return (field.min !== undefined && v < field.min) || (field.max !== undefined && v > field.max);
}

function Chip({ label, selected, onPress, color = colors.primary }: { label: string; selected: boolean; onPress: () => void; color?: string }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        paddingVertical: 12,
        borderRadius: 10,
        borderWidth: 1.5,
        alignItems: 'center',
        borderColor: selected ? color : colors.border,
        backgroundColor: selected ? `${color}1A` : '#fff',
      }}
    >
      <Text style={{ fontWeight: '700', color: selected ? color : colors.text }}>{label}</Text>
    </Pressable>
  );
}

function FieldInput({ field, value, onChange }: { field: FormField; value: Value; onChange: (v: Value) => void }) {
  const label = `${field.labelAr}${field.unit ? ` (${field.unit})` : ''}${field.required || field.ccpMeasurement ? ' *' : ''}`;

  if (field.type === 'boolean') {
    const nonCompliant = field.expected !== undefined && value !== undefined && value !== field.expected;
    return (
      <View style={{ marginBottom: 14 }}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.row}>
          <Chip label="نعم" selected={value === true} onPress={() => onChange(true)} color={field.expected === false ? colors.danger : colors.success} />
          <Chip label="لا" selected={value === false} onPress={() => onChange(false)} color={field.expected === true ? colors.danger : colors.success} />
        </View>
        {nonCompliant ? <Text style={[styles.hint, { color: colors.danger }]}>إجابة غير مطابقة — سيتم فتح إجراء تصحيحي</Text> : null}
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

  const bad = outOfLimit(field, value);
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
  const [values, setValues] = useState<Record<string, Value>>({});
  const [batchNo, setBatchNo] = useState('');
  const [notes, setNotes] = useState('');
  const [department, setDepartment] = useState<Department | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MonitoringRecord | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const f = await api<ResolvedForm>('/qr/resolve', { method: 'POST', body: { payload } });
        setForm(f);
        setDepartment(f.department ?? user?.department_code ?? null);
        const initial: Record<string, Value> = {};
        f.template.fields.forEach((fld) => {
          if (fld.type === 'date') initial[fld.key] = today();
        });
        setValues(initial);
      } catch (e) {
        setLoadError(errorMessage(e));
      }
    })();
  }, [payload, user]);

  const missing = useMemo(
    () =>
      form?.template.fields.filter((f) => (f.required || f.ccpMeasurement) && (values[f.key] === undefined || values[f.key] === '')) ?? [],
    [form, values],
  );

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
      } else {
        data[f.key] = typeof v === 'string' ? v.trim() : v;
      }
    }
    const productField = form.template.fields.find((f) => f.key === 'product' || f.key === 'produce');
    setBusy(true);
    try {
      const record = await api<MonitoringRecord>(`/kitchens/${department.toLowerCase()}/records`, {
        method: 'POST',
        body: {
          templateId: form.template.id,
          equipmentId: form.equipment?.id,
          data,
          productName: productField ? data[productField.key] : undefined,
          batchNo: batchNo || undefined,
          notes: notes || undefined,
          source: source === 'MANUAL' ? 'MANUAL' : 'QR',
        },
      });
      setResult(record);
    } catch (e) {
      setSubmitError(errorMessage(e));
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
            <FieldInput key={f.key} field={f} value={values[f.key]} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
          ))}
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
