import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { api, ApiError, errorMessage } from '@/api/client';
import type { Department, FillContext, MonitoringRecord, ResolvedForm, ResolvedLabel } from '@/api/types';
import { Chip, FieldInput } from '@/components/FormFields';
import { Badge, Button, Card, Empty, Input, Loading, styles } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { deviceId } from '@/device';
import { computeValues, deviates, isCriticalDeviation, thisMonth, toPayload, Values } from '@/formLogic';
import { cacheForm, cachedForm, enqueue, newClientRef } from '@/offline';
import { colors, departmentLabel, roleLabel, textStart } from '@/theme';

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={[styles.row, { paddingVertical: 3 }]}>
      <Text style={{ width: 22 }}>{icon}</Text>
      <Text style={[styles.muted, { width: 92 }]}>{label}</Text>
      <Text style={[styles.body, { flex: 1, fontWeight: '700' }]} selectable>{value}</Text>
    </View>
  );
}

/** Who fills what, where, on which device and when — shown before filling and stored with the record. */
function FillHeader({ ctx, device, siteFallback }: { ctx?: FillContext; device: string | null; siteFallback?: string | null }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!ctx) return null;
  const edit = ctx.access === 'FILL_EDIT';
  return (
    <Card style={{ backgroundColor: '#F8FBF9', borderColor: colors.primaryLight }}>
      <InfoRow icon="🏢" label="الشركة" value={`${ctx.company.name}`} />
      <InfoRow icon="📍" label="الموقع" value={[ctx.site ?? siteFallback, ctx.branch && ctx.site !== ctx.branch ? ctx.branch : null].filter(Boolean).join(' — ')} />
      <InfoRow icon="🔖" label="رقم الجهاز" value={ctx.deviceNo ? `${ctx.deviceNo}${device ? ` · جوال/متصفح ${device}` : ''}` : device} />
      <InfoRow icon="🕒" label="وقت التعبئة" value={now.toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' })} />
      <InfoRow icon="👤" label="الموظف" value={`${ctx.employee.name} · ${ctx.employee.employeeNo} · ${roleLabel[ctx.employee.role] ?? ctx.employee.role}${ctx.employee.department ? ` · ${departmentLabel[ctx.employee.department]}` : ''}`} />
      <View style={{ marginTop: 8, alignItems: 'flex-start' }}>
        <Badge text={edit ? '✏️ صلاحيتك: تعبئة وتعديل' : '📝 صلاحيتك: تعبئة فقط (بدون تعديل بعد الحفظ)'} color={edit ? colors.primary : colors.warning} />
      </View>
    </Card>
  );
}

export default function FormScreen() {
  const { payload, source } = useLocalSearchParams<{ payload: string; source?: string }>();
  const { user, can } = useAuth();
  const [form, setForm] = useState<ResolvedForm | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [values, setValues] = useState<Values>({});
  const [auto, setAuto] = useState<Set<string>>(new Set());
  const [carried, setCarried] = useState<Set<string>>(new Set());
  const [batchNo, setBatchNo] = useState('');
  const [notes, setNotes] = useState('');
  const [actionTaken, setActionTaken] = useState('');
  const [department, setDepartment] = useState<Department | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MonitoringRecord | null>(null);
  const [queued, setQueued] = useState(false);
  const [device, setDevice] = useState<string | null>(null);
  // One id per filled form: a retried or replayed submission is never recorded twice.
  const clientRef = useMemo(() => newClientRef(), []);

  useEffect(() => {
    void deviceId().then(setDevice);
  }, []);

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
      const initial: Values = {};
      const autoKeys = new Set<string>();
      const carriedKeys = new Set<string>();
      for (const fld of f.template.fields) {
        if (fld.type === 'month') initial[fld.key] = thisMonth();
        const pre = f.prefill?.[fld.key];
        if (pre !== undefined && pre !== null && pre !== '') {
          initial[fld.key] = typeof pre === 'number' ? String(pre) : (pre as string);
          (fld.carryFrom ? carriedKeys : autoKeys).add(fld.key);
        }
      }
      setValues(initial);
      setAuto(autoKeys);
      setCarried(carriedKeys);
    })();
  }, [payload, user]);

  const fields = form?.template.fields ?? [];
  const computed = useMemo(() => computeValues(fields, values), [fields, values]);

  // Carry-over (e.g. opening balance of the same item from last month) follows the matching answers.
  const carryFields = fields.filter((f) => f.carryFrom);
  const matchKey = JSON.stringify(carryFields.flatMap((f) => (f.carryMatch ?? []).map((k) => values[k] ?? null)));
  const lastMatch = useRef<string | null>(null);
  useEffect(() => {
    if (!form || !carryFields.length || fromCache || lastMatch.current === matchKey) return;
    lastMatch.current = matchKey;
    const timer = setTimeout(async () => {
      try {
        const match: Record<string, unknown> = {};
        carryFields.forEach((f) => (f.carryMatch ?? []).forEach((k) => (match[k] = values[k])));
        const pre = await api<Record<string, unknown>>(`/haccp/templates/${form.template.id}/prefill`, {
          method: 'POST', body: { equipmentId: form.equipment?.id, data: match },
        });
        const next = new Set<string>();
        setValues((s) => {
          const copy = { ...s };
          for (const f of carryFields) {
            if (pre[f.key] !== undefined && pre[f.key] !== null) {
              copy[f.key] = String(pre[f.key]);
              next.add(f.key);
            } else if (carried.has(f.key)) copy[f.key] = '';
          }
          return copy;
        });
        setCarried(next);
      } catch { /* offline: the server applies the carry-over on submit */ }
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, matchKey]);

  const hasDeviation = fields.some((f) => deviates(f, computed[f.key], computed));
  const hasCritical = fields.some((f) => isCriticalDeviation(f, computed[f.key], computed));

  // A critical deviation forces the decision (e.g. the shipment must be rejected).
  useEffect(() => {
    if (!hasCritical) return;
    const forced = fields.filter((f) => f.onCriticalDeviation && values[f.key] !== f.onCriticalDeviation);
    if (forced.length) setValues((s) => ({ ...s, ...Object.fromEntries(forced.map((f) => [f.key, f.onCriticalDeviation!])) }));
  }, [hasCritical, fields, values]);

  const missing = fields.filter((f) => !f.compute && (f.required || f.ccpMeasurement) && (values[f.key] === undefined || values[f.key] === '' || values[f.key] === null));

  const submit = async () => {
    if (!form || !department) return;
    setSubmitError(null);
    const { data, error } = toPayload(fields, values);
    if (error) return setSubmitError(error);
    const productField = fields.find((f) => f.key === 'product' || f.key === 'produce' || f.key === 'item_name');
    const body = {
      templateId: form.template.id,
      equipmentId: form.equipment?.id,
      data,
      productName: productField ? data[productField.key] : undefined,
      batchNo: batchNo || (typeof data.batch_number === 'string' ? data.batch_number : undefined),
      notes: notes || undefined,
      correctiveActionTaken: actionTaken.trim() || undefined,
      source: source === 'MANUAL' ? 'MANUAL' : 'QR',
      clientRef,
      deviceId: device ?? undefined,
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
          <Text style={[styles.muted, { textAlign: 'center' }]}>
            رقم السجل {result.id.slice(0, 8).toUpperCase()} · {new Date(result.recorded_at).toLocaleString('ar-SA')}
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
        <Button title="📄 عرض السجل" variant="outline"
          onPress={() => router.replace({ pathname: '/records/[id]', params: { id: result.id, department: result.department_code } })} />
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
          {form.template.description ? <Text style={[styles.muted, { marginTop: 4 }]}>{form.template.description}</Text> : null}
          {form.equipment ? (
            <Text style={[styles.body, { marginTop: 6 }]}>
              الجهاز: {form.equipment.code} — {form.equipment.name} {form.equipment.location ? `(${form.equipment.location})` : ''}
            </Text>
          ) : null}
          {form.minDailyEntries ? (
            <Text style={[styles.hint, { color: colors.warning }]}>⏱ التكرار المطلوب: {form.minDailyEntries} قراءات يومياً كحد أدنى</Text>
          ) : null}
          {form.ccp ? (
            <View style={{ marginTop: 10 }}>
              <Badge text={`${form.ccp.code} · الحد الحرج ${form.ccp.criticalLimit}`} color={colors.danger} />
              <Text style={[styles.muted, { marginTop: 6 }]}>الخطر: {form.ccp.hazard}</Text>
            </View>
          ) : null}
        </Card>

        <FillHeader ctx={form.context} device={device} siteFallback={form.equipment?.location} />

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
          {fields.map((f) => (
            <FieldInput key={f.key} field={f} value={computed[f.key]} values={computed}
              locked={auto.has(f.key) ? 'auto' : carried.has(f.key) ? 'carried' : undefined}
              onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
          ))}
          {hasDeviation ? (
            <View style={{ backgroundColor: colors.dangerLight, borderRadius: 12, padding: 12, marginBottom: 14 }}>
              <Text style={[styles.label, { color: colors.danger }]}>⚠ يوجد انحراف — ما الإجراء الذي اتخذته فوراً؟</Text>
              {form.ccp ? <Text style={[styles.hint, { marginBottom: 8 }]}>الإجراء المعتمد: {form.ccp.correctiveAction}</Text> : null}
              <Input value={actionTaken} onChangeText={setActionTaken} multiline placeholder="مثال: رُفضت الشحنة وأُبلغ قسم المشتريات"
                style={{ minHeight: 60 }} />
            </View>
          ) : null}
          {!fields.some((f) => f.key === 'batch_number') ? <Input label="رقم الدفعة (اختياري)" value={batchNo} onChangeText={setBatchNo} /> : null}
          <Input label="ملاحظات (اختياري)" value={notes} onChangeText={setNotes} multiline style={{ minHeight: 70 }} />
        </Card>

        {submitError ? <Text style={{ color: colors.danger, marginBottom: 8, textAlign: textStart }}>{submitError}</Text> : null}
        <Button title="حفظ السجل" onPress={submit} loading={busy} disabled={missing.length > 0 || !department} />
        {missing.length > 0 ? <Text style={[styles.muted, { textAlign: 'center' }]}>أكمل الحقول الإلزامية ({missing.length})</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
