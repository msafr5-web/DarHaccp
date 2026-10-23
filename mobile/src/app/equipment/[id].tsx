import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import type { Department, Equipment, EquipmentStatus, FormTemplateSummary, MaintenanceLog, QrLabel } from '@/api/types';
import { MaintenanceBadge, TodayBadge, typeInfo } from '@/components/EquipmentBadges';
import { Badge, Button, Card, Chips, Empty, Input, Loading, styles } from '@/components/ui';
import { EQUIPMENT_STATUS, EQUIPMENT_TYPES, MAINTENANCE_TYPE } from '@/constants';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { printLabels, shareLink } from '@/printLabels';
import { colors, departmentLabel, textStart } from '@/theme';

const DEPTS: Department[] = ['SUPPORT', 'HOT', 'COLD', 'SWEETS'];
const todayIso = () => new Date().toISOString().slice(0, 10);
type Msg = { text: string; ok: boolean } | null;

function Note({ m }: { m: Msg }) {
  return m ? <Text style={{ color: m.ok ? colors.success : colors.danger, marginBottom: 8, textAlign: textStart }}>{m.text}</Text> : null;
}

/** Add or edit a device: identity, location, department and the monitoring form its QR code opens. */
function DetailsForm({ e, templates, onSaved, onCancel }: {
  e: Equipment | null; templates: FormTemplateSummary[]; onSaved: (e: Equipment) => void; onCancel?: () => void;
}) {
  const [code, setCode] = useState(e?.code ?? '');
  const [name, setName] = useState(e?.name ?? '');
  const [type, setType] = useState(e?.type ?? 'DATA_LOGGER');
  const [department, setDepartment] = useState<Department>(e?.department_code ?? 'SUPPORT');
  const [location, setLocation] = useState(e?.location ?? '');
  const [formId, setFormId] = useState<string>(e?.form_template_id ?? 'NONE');
  const [interval, setInterval] = useState(String(e?.maintenance_interval_days ?? 90));
  const [lastMaint, setLastMaint] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  // Forms the equipment's department may use; a form bound to another department cannot be linked.
  const usable = templates.filter((t) => !t.department_code || t.department_code === department);
  useEffect(() => {
    if (formId !== 'NONE' && !usable.some((t) => t.id === formId)) setFormId('NONE');
  }, [department]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const common = {
      name: name.trim(), type, department, maintenanceIntervalDays: Number(interval) || 90,
    };
    try {
      const saved = e
        ? await api<Equipment>(`/equipment/${e.id}`, { method: 'PATCH', body: {
            ...common, location: location.trim() || null, formTemplateId: formId === 'NONE' ? null : formId,
          } })
        : await api<Equipment>('/equipment', { method: 'POST', body: {
            ...common, code: code.trim(), location: location.trim() || undefined, formTemplateId: formId === 'NONE' ? undefined : formId,
            lastMaintenanceDate: lastMaint.trim() || undefined,
          } });
      onSaved(saved);
    } catch (err) {
      setMsg({ text: errorMessage(err), ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ borderColor: colors.primary }}>
      <Text style={styles.title}>{e ? 'تعديل بيانات الجهاز' : 'جهاز جديد'}</Text>
      {e ? <Text style={[styles.muted, { marginBottom: 8 }]}>رقم الجهاز {e.code} ثابت — يظهر في كل السجلات السابقة.</Text> : (
        <Input label="رقم الجهاز *" value={code} onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
          autoCapitalize="characters" placeholder="DL-CS-03" hint="فريد في شركتك، يُطبع على الملصق ويُسجَّل مع كل قراءة" />
      )}
      <Input label="الاسم *" value={name} onChangeText={setName} placeholder="مسجل بيانات مستودع التبريد 3" />
      <Text style={styles.label}>النوع</Text>
      <Chips value={type} onChange={setType} options={Object.entries(EQUIPMENT_TYPES).map(([v, t]) => ({ value: v, label: `${t.icon} ${t.label}` }))} />
      <Text style={styles.label}>القسم</Text>
      <Chips value={department} onChange={setDepartment} options={DEPTS.map((d) => ({ value: d, label: departmentLabel[d] }))} />
      <Input label="الموقع / المنطقة" value={location} onChangeText={setLocation} placeholder="مستودع التبريد 3 — رف A"
        hint="يُملأ تلقائياً في حقل المنطقة عند مسح رمز الجهاز" />
      <Text style={styles.label}>النموذج الذي يفتحه رمز QR</Text>
      <Chips value={formId} onChange={setFormId}
        options={[{ value: 'NONE', label: 'بدون' }, ...usable.map((t) => ({ value: t.id, label: t.title_ar }))]} />
      <Input label="دورة الصيانة الوقائية (يوم)" value={interval} onChangeText={setInterval} keyboardType="number-pad" />
      {!e ? (
        <Input label="تاريخ آخر صيانة (اختياري)" value={lastMaint} onChangeText={setLastMaint} placeholder="YYYY-MM-DD"
          hint="تُحسب منه الصيانة القادمة؛ وإلا من اليوم" />
      ) : null}
      <Note m={msg} />
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Button title={e ? 'حفظ التعديلات' : 'إضافة الجهاز وإصدار رمز QR'} loading={busy}
            disabled={name.trim().length < 2 || (!e && code.length < 2)} onPress={save} />
        </View>
        {onCancel ? <View style={{ flex: 1 }}><Button title="إلغاء" variant="outline" onPress={onCancel} /></View> : null}
      </View>
    </Card>
  );
}

/** The device's QR label: preview, print, share, fill now, and replace a lost / damaged label. */
function QrCard({ e, onRotated }: { e: Equipment; onRotated: () => void }) {
  const { can } = useAuth();
  const [label, setLabel] = useState<QrLabel | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [l] = await api<QrLabel[]>('/qr/labels-data', { method: 'POST', body: { target: 'equipment', ids: [e.id] } });
      setLabel(l ?? null);
    } catch (err) {
      setMsg({ text: errorMessage(err), ok: false });
    }
  }, [e.id]);
  useEffect(() => {
    if (can('qr:manage')) void load();
  }, [load, can, e.qr_token]);

  return (
    <Card>
      <Text style={styles.title}>رمز QR للجهاز</Text>
      {label ? (
        <View style={{ alignItems: 'center', marginVertical: 8 }}>
          <Image source={{ uri: label.dataUrl }} style={{ width: 220, height: 220 }} accessibilityLabel={`QR ${e.code}`} />
          <Text style={[styles.muted, { fontSize: 11, writingDirection: 'ltr' }]} selectable>{label.payload}</Text>
        </View>
      ) : can('qr:manage') ? <Loading /> : null}
      <Text style={[styles.muted, { marginBottom: 8 }]}>
        يُلصق على الجهاز؛ مسحه بكاميرا أي جوال يفتح {e.form_title_ar ? `«${e.form_title_ar}»` : 'النموذج المرتبط'} مع رقم الجهاز والموقع تلقائياً.
      </Text>
      <Note m={msg} />
      {e.form_template_id ? (
        <Button title="📝 تعبئة النموذج الآن" onPress={() => router.push({ pathname: '/form', params: { payload: e.qr_token } })} />
      ) : <Text style={[styles.hint, { color: colors.warning }]}>اربط نموذجاً بالجهاز ليعمل رمزه.</Text>}
      {label ? (
        <View style={[styles.row, { flexWrap: 'wrap' }]}>
          <View style={{ flex: 1, minWidth: 140 }}><Button title="🖨 طباعة الملصق" variant="outline" onPress={() => void printLabels([label], 'large')} /></View>
          <View style={{ flex: 1, minWidth: 140 }}>
            <Button title="🔗 مشاركة الرابط" variant="outline" onPress={async () => {
              const r = await shareLink(label);
              if (r === 'copied') setMsg({ text: 'نُسخ الرابط', ok: true });
            }} />
          </View>
        </View>
      ) : null}
      {can('qr:manage') ? (
        confirmRotate ? (
          <Card style={{ backgroundColor: colors.warningLight, borderColor: colors.warning }}>
            <Text style={[styles.body, { marginBottom: 8 }]}>سيتوقف الملصق الحالي فوراً ويجب طباعة ولصق الملصق الجديد. متابعة؟</Text>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Button title="نعم، إصدار رمز جديد" variant="danger" loading={busy} onPress={async () => {
                  setBusy(true);
                  try {
                    await api(`/qr/equipment/${e.id}/rotate`, { method: 'POST' });
                    setConfirmRotate(false);
                    setMsg({ text: 'صدر رمز جديد — اطبع الملصق الجديد', ok: true });
                    onRotated();
                  } catch (err) {
                    setMsg({ text: errorMessage(err), ok: false });
                  } finally {
                    setBusy(false);
                  }
                }} />
              </View>
              <View style={{ flex: 1 }}><Button title="إلغاء" variant="outline" onPress={() => setConfirmRotate(false)} /></View>
            </View>
          </Card>
        ) : <Button title="🔄 ملصق تالف أو مفقود؟ إصدار رمز جديد" variant="outline" onPress={() => setConfirmRotate(true)} />
      ) : null}
    </Card>
  );
}

function Maintenance({ e, onDone }: { e: Equipment; onDone: () => void }) {
  const { can } = useAuth();
  const { data: logs, reload } = useApi<MaintenanceLog[]>(`/equipment/${e.id}/maintenance`);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<MaintenanceLog['type']>('PREVENTIVE');
  const [description, setDescription] = useState('');
  const [vendor, setVendor] = useState('');
  const [date, setDate] = useState(todayIso());
  const [result, setResult] = useState<EquipmentStatus>('OPERATIONAL');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  return (
    <Card>
      <Text style={styles.title}>الصيانة والمعايرة</Text>
      <Text style={styles.muted}>
        آخر صيانة: {e.last_maintenance_date ?? '—'} · القادمة: {e.next_maintenance_date ?? '—'} · كل {e.maintenance_interval_days} يوماً
      </Text>
      <Note m={msg} />
      {can('equipment:manage') ? (
        open ? (
          <View style={{ marginTop: 10 }}>
            <Chips value={type} onChange={setType} options={Object.entries(MAINTENANCE_TYPE).map(([v, l]) => ({ value: v as MaintenanceLog['type'], label: l }))} />
            <Input label="ما الذي تم؟ *" value={description} onChangeText={setDescription} multiline placeholder="معايرة الحساس مقابل مقياس مرجعي" />
            <Input label="الجهة المنفذة" value={vendor} onChangeText={setVendor} />
            <Input label="التاريخ" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
            <Text style={styles.label}>حالة الجهاز بعد الصيانة</Text>
            <Chips value={result} onChange={setResult}
              options={Object.entries(EQUIPMENT_STATUS).map(([v, s]) => ({ value: v as EquipmentStatus, label: s.label, color: s.color }))} />
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Button title="تسجيل" loading={busy} disabled={description.trim().length < 3} onPress={async () => {
                  setBusy(true);
                  setMsg(null);
                  try {
                    await api(`/equipment/${e.id}/maintenance`, { method: 'POST', body: {
                      type, description: description.trim(), vendor: vendor.trim() || undefined, performedAt: date, resultingStatus: result,
                    } });
                    setOpen(false);
                    setDescription('');
                    setVendor('');
                    setMsg({ text: 'سُجّلت الصيانة وتحدّث موعد الصيانة القادمة', ok: true });
                    void reload();
                    onDone();
                  } catch (err) {
                    setMsg({ text: errorMessage(err), ok: false });
                  } finally {
                    setBusy(false);
                  }
                }} />
              </View>
              <View style={{ flex: 1 }}><Button title="إلغاء" variant="outline" onPress={() => setOpen(false)} /></View>
            </View>
          </View>
        ) : <Button title="🔧 تسجيل صيانة أو معايرة" variant="outline" onPress={() => setOpen(true)} />
      ) : null}
      {(logs ?? []).map((m) => (
        <View key={m.id} style={{ paddingVertical: 8, borderTopWidth: 1, borderColor: '#F2F4F7' }}>
          <Text style={[styles.body, { fontWeight: '700' }]}>{MAINTENANCE_TYPE[m.type]} · {m.performed_at.slice(0, 10)}</Text>
          <Text style={styles.body}>{m.description}</Text>
          <Text style={styles.muted}>{m.performed_by_name}{m.vendor ? ` · ${m.vendor}` : ''}{m.next_due_date ? ` · القادمة ${m.next_due_date.slice(0, 10)}` : ''}</Text>
        </View>
      ))}
    </Card>
  );
}

/** Smart probe (IoT): an API key the sensor uses to send readings without a person. Shown once. */
function DeviceKey({ e, onIssued }: { e: Equipment; onIssued: () => void }) {
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <Card>
      <Text style={styles.title}>🔌 مجس آلي (إنترنت الأشياء)</Text>
      <Text style={[styles.muted, { marginBottom: 8 }]}>
        {e.has_device_key ? 'للجهاز مفتاح صادر. إصدار مفتاح جديد يوقف القديم فوراً.' : 'أصدر مفتاحاً ليرسل الحساس قراءاته تلقائياً وتُقيَّم بنفس الحدود الحرجة.'}
      </Text>
      <Note m={msg} />
      {key ? (
        <View style={{ backgroundColor: '#F2F4F7', borderRadius: 10, padding: 10, marginBottom: 8 }}>
          <Text style={[styles.label, { color: colors.danger }]}>انسخ المفتاح الآن — لن يظهر مرة أخرى</Text>
          <Text selectable style={{ fontFamily: 'monospace', fontSize: 12, writingDirection: 'ltr', textAlign: 'left' }}>{key}</Text>
          <Text selectable style={[styles.muted, { fontSize: 11, marginTop: 6, writingDirection: 'ltr', textAlign: 'left' }]}>
            POST /api/v1/iot/readings · X-Device-Key: &lt;key&gt; · {'{"value": 3.5}'}
          </Text>
        </View>
      ) : null}
      <Button title={e.has_device_key ? 'إصدار مفتاح جديد' : 'إصدار مفتاح المجس'} variant="outline" loading={busy} disabled={!e.form_template_id}
        onPress={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const r = await api<{ deviceKey: string }>(`/equipment/${e.id}/device-key`, { method: 'POST' });
            setKey(r.deviceKey);
            onIssued();
          } catch (err) {
            setMsg({ text: errorMessage(err), ok: false });
          } finally {
            setBusy(false);
          }
        }} />
    </Card>
  );
}

export default function EquipmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const { can } = useAuth();
  const manage = can('equipment:manage');
  const { data: e, error, reload, setData } = useApi<Equipment>(isNew ? null : `/equipment/${id}`);
  const { data: templates } = useApi<FormTemplateSummary[]>('/haccp/templates');
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  if (isNew) {
    if (!manage) return <Empty text="لا تملك صلاحية إضافة الأجهزة" />;
    return (
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Stack.Screen options={{ title: 'جهاز جديد' }} />
        <DetailsForm e={null} templates={templates ?? []}
          onSaved={(saved) => router.replace({ pathname: '/equipment/[id]', params: { id: saved.id } })} />
      </ScrollView>
    );
  }
  if (error) return <Empty text={error} />;
  if (!e) return <Loading />;

  const t = typeInfo(e.type);
  const st = EQUIPMENT_STATUS[e.status]!;
  const setStatus = async (status: EquipmentStatus) => {
    setMsg(null);
    try {
      setData(await api<Equipment>(`/equipment/${e.id}`, { method: 'PATCH', body: { status } }));
    } catch (err) {
      setMsg({ text: errorMessage(err), ok: false });
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: e.code }} />
      <Card style={{ borderRightWidth: 5, borderRightColor: st.color }}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text style={{ fontSize: 34 }}>{t.icon}</Text>
          <View style={{ flex: 1, marginHorizontal: 10 }}>
            <Text style={styles.title}>{e.name}</Text>
            <Text style={[styles.body, { color: colors.primary, fontWeight: '800' }]} selectable>{e.code}</Text>
          </View>
          <Badge text={st.label} color={st.color} />
        </View>
        <Text style={[styles.muted, { marginTop: 6 }]}>
          {t.label} · {departmentLabel[e.department_code]}{e.location ? ` · 📍 ${e.location}` : ''}
        </Text>
        <Text style={styles.muted}>📋 {e.form_title_ar ?? 'لا يوجد نموذج مرتبط'}</Text>
        <Text style={styles.muted}>آخر قراءة: {e.last_reading_at ? new Date(e.last_reading_at).toLocaleString('ar-SA') : '—'}</Text>
        <View style={[styles.row, { marginTop: 6, flexWrap: 'wrap' }]}>
          <TodayBadge e={e} />
          <MaintenanceBadge e={e} />
        </View>
      </Card>
      <Note m={msg} />

      <QrCard e={e} onRotated={reload} />

      <Button title="📄 قراءات وسجلات هذا الجهاز" variant="outline"
        onPress={() => router.push({ pathname: '/records', params: { equipmentId: e.id, department: e.department_code, title: e.code } })} />

      {manage ? (
        <Card>
          <Text style={styles.label}>حالة الجهاز</Text>
          <Chips value={e.status} onChange={(s) => void setStatus(s)}
            options={Object.entries(EQUIPMENT_STATUS).map(([v, s]) => ({ value: v as EquipmentStatus, label: s.label, color: s.color }))} />
          {e.status === 'OUT_OF_SERVICE' ? (
            <Text style={[styles.hint, { color: colors.danger }]}>خارج الخدمة: يرفض رمز QR فتح النموذج حتى لا يُستخدم الجهاز لحفظ الغذاء.</Text>
          ) : null}
        </Card>
      ) : null}

      {manage ? (
        editing
          ? <DetailsForm e={e} templates={templates ?? []} onCancel={() => setEditing(false)}
              onSaved={(saved) => { setData(saved); setEditing(false); setMsg({ text: 'تم حفظ بيانات الجهاز', ok: true }); }} />
          : <Button title="✏️ تعديل بيانات الجهاز" variant="outline" onPress={() => setEditing(true)} />
      ) : null}

      <Maintenance e={e} onDone={reload} />

      {can('iot:manage') ? <DeviceKey e={e} onIssued={reload} /> : null}

      {manage ? (
        confirmArchive ? (
          <Card style={{ backgroundColor: colors.dangerLight, borderColor: colors.danger }}>
            <Text style={[styles.body, { marginBottom: 8 }]}>
              أرشفة الجهاز تخفيه من القوائم ويتوقف رمزه. سجلاته وقراءاته السابقة تبقى محفوظة.
            </Text>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Button title="تأكيد الأرشفة" variant="danger" onPress={async () => {
                  try {
                    await api(`/equipment/${e.id}`, { method: 'PATCH', body: { isActive: false } });
                    router.back();
                  } catch (err) {
                    setMsg({ text: errorMessage(err), ok: false });
                  }
                }} />
              </View>
              <View style={{ flex: 1 }}><Button title="إلغاء" variant="outline" onPress={() => setConfirmArchive(false)} /></View>
            </View>
          </Card>
        ) : <Button title="🗄 أرشفة الجهاز" variant="danger" onPress={() => setConfirmArchive(true)} />
      ) : null}
    </ScrollView>
  );
}
