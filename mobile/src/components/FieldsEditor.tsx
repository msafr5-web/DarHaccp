import { useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import type { FieldType, FormField } from '../api/types';
import { colors, textStart } from '../theme';
import { Badge, Card, Chips, Input, styles } from './ui';

/**
 * Platform administrator's field editor: add / remove / reorder fields and edit their HACCP rules.
 * Common settings have inputs; the advanced rules (conditional limits, computed values, carry-over,
 * uniqueness, auto-fill…) are edited as JSON. The server validates the whole definition on save.
 */

const TYPES: { value: FieldType; label: string }[] = [
  { value: 'number', label: 'رقم' }, { value: 'text', label: 'نص' }, { value: 'boolean', label: 'نعم/لا' },
  { value: 'select', label: 'اختيار' }, { value: 'date', label: 'تاريخ' }, { value: 'month', label: 'شهر' }, { value: 'time', label: 'وقت' },
];

const BASIC = ['key', 'labelAr', 'labelEn', 'type', 'required', 'critical', 'unit', 'min', 'max', 'validMin', 'validMax', 'options', 'expected', 'hint'] as const;

export interface FieldDraft {
  uid: string;
  isNew: boolean;
  key: string;
  labelAr: string;
  labelEn: string;
  type: FieldType;
  required: boolean;
  critical: boolean;
  unit: string;
  min: string;
  max: string;
  validMin: string;
  validMax: string;
  options: string;
  expected: 'none' | 'yes' | 'no';
  hint: string;
  advanced: string;
}

let seq = 0;
const num = (v: number | undefined) => (v === undefined ? '' : String(v));

export function toDrafts(fields: FormField[]): FieldDraft[] {
  return fields.map((f) => {
    const adv = Object.fromEntries(Object.entries(f).filter(([k]) => !(BASIC as readonly string[]).includes(k)));
    return {
      uid: `f${++seq}`, isNew: false, key: f.key, labelAr: f.labelAr, labelEn: f.labelEn, type: f.type,
      required: !!f.required, critical: !!f.critical, unit: f.unit ?? '', min: num(f.min), max: num(f.max),
      validMin: num(f.validMin), validMax: num(f.validMax), options: (f.options ?? []).join('\n'),
      expected: f.expected === undefined ? 'none' : f.expected ? 'yes' : 'no', hint: f.hint ?? '',
      advanced: Object.keys(adv).length ? JSON.stringify(adv, null, 1) : '',
    };
  });
}

/** Builds the field list sent to the API (or the first error, with the field it concerns). */
export function fromDrafts(drafts: FieldDraft[]): { fields: FormField[]; error: string | null } {
  const fields: FormField[] = [];
  for (const d of drafts) {
    const name = d.labelAr || d.key || 'حقل';
    const n = (v: string, label: string) => {
      if (v.trim() === '') return undefined;
      const x = Number(v.replace(',', '.'));
      if (Number.isNaN(x)) throw new Error(`${name}: ${label} يجب أن يكون رقماً`);
      return x;
    };
    try {
      let adv: Record<string, unknown> = {};
      if (d.advanced.trim()) {
        try { adv = JSON.parse(d.advanced); } catch { throw new Error(`${name}: القواعد المتقدمة ليست JSON صحيحاً`); }
      }
      const f: FormField = {
        key: d.key.trim(), labelAr: d.labelAr.trim(), labelEn: d.labelEn.trim() || d.key.trim(), type: d.type,
        ...(d.required ? { required: true } : {}), ...(d.critical ? { critical: true } : {}),
        ...(d.unit.trim() ? { unit: d.unit.trim() } : {}), ...(d.hint.trim() ? { hint: d.hint.trim() } : {}),
        ...(adv as Partial<FormField>),
      };
      const nums = { min: n(d.min, 'الحد الأدنى'), max: n(d.max, 'الحد الأعلى'), validMin: n(d.validMin, 'أقل قيمة مسموحة'), validMax: n(d.validMax, 'أعلى قيمة مسموحة') };
      for (const [k, v] of Object.entries(nums)) if (v !== undefined) (f as unknown as Record<string, number>)[k] = v;
      const options = d.options.split('\n').map((o) => o.trim()).filter(Boolean);
      if (d.type === 'select') f.options = options;
      if (d.type === 'boolean' && d.expected !== 'none') f.expected = d.expected === 'yes';
      if (!/^[a-z][a-z0-9_]{1,40}$/.test(f.key)) throw new Error(`${name}: المفتاح بالإنجليزية الصغيرة وشرطة سفلية (مثل vehicle_temp)`);
      if (!f.labelAr) throw new Error(`${f.key}: الاسم العربي مطلوب`);
      fields.push(f);
    } catch (e) {
      return { fields, error: (e as Error).message };
    }
  }
  if (new Set(fields.map((f) => f.key)).size !== fields.length) return { fields, error: 'مفاتيح الحقول يجب ألا تتكرر' };
  return { fields, error: null };
}

function Small({ label, onPress, color = colors.primary }: { label: string; onPress: () => void; color?: string }) {
  return (
    <Pressable onPress={onPress} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: color }}>
      <Text style={{ color, fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={[styles.row, { justifyContent: 'space-between', marginBottom: 10 }]}>
      <Text style={styles.body}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary }} />
    </View>
  );
}

function ruleBadges(d: FieldDraft): string[] {
  const out: string[] = [];
  if (d.required) out.push('إلزامي');
  if (d.critical) out.push('حرج (CCP)');
  if (d.min || d.max) out.push(`حد حرج ${d.min || '…'}–${d.max || '…'}`);
  if (d.validMin || d.validMax) out.push(`مسموح ${d.validMin || '…'}–${d.validMax || '…'}`);
  try {
    const a = d.advanced.trim() ? JSON.parse(d.advanced) : {};
    if (a.limitsBy) out.push('حدود شرطية');
    if (a.compute) out.push('محسوب');
    if (a.after) out.push(`بعد ${a.after}`);
    if (a.unique) out.push('فريد');
    if (a.carryFrom) out.push('مُرحَّل');
    if (a.prefill) out.push('تلقائي من QR');
    if (a.companyOptions) out.push('قائمة الشركة');
    if (a.ccpMeasurement) out.push('قراءة CCP');
  } catch { out.push('⚠ JSON'); }
  return out;
}

export function FieldsEditor({ drafts, onChange }: { drafts: FieldDraft[]; onChange: (d: FieldDraft[]) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const update = (uid: string, patch: Partial<FieldDraft>) => onChange(drafts.map((d) => (d.uid === uid ? { ...d, ...patch } : d)));
  const move = (i: number, by: number) => {
    const next = [...drafts];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x!);
    onChange(next);
  };

  return (
    <View>
      {drafts.map((d, i) => {
        const expanded = open === d.uid;
        return (
          <Card key={d.uid} style={{ borderColor: expanded ? colors.primary : colors.border, padding: 12 }}>
            <Pressable onPress={() => setOpen(expanded ? null : d.uid)}>
              <View style={[styles.row, { justifyContent: 'space-between' }]}>
                <Text style={[styles.body, { fontWeight: '800', flex: 1 }]}>{i + 1}. {d.labelAr || 'حقل جديد'}</Text>
                <Badge text={TYPES.find((t) => t.value === d.type)?.label ?? d.type} color={colors.muted} />
              </View>
              <Text style={[styles.muted, { fontSize: 12 }]}>{d.key} {ruleBadges(d).length ? `· ${ruleBadges(d).join(' · ')}` : ''}</Text>
            </Pressable>
            <View style={[styles.row, { marginTop: 8, flexWrap: 'wrap' }]}>
              <Small label={expanded ? 'إغلاق' : 'تعديل'} onPress={() => setOpen(expanded ? null : d.uid)} />
              {i > 0 ? <Small label="▲" onPress={() => move(i, -1)} /> : null}
              {i < drafts.length - 1 ? <Small label="▼" onPress={() => move(i, 1)} /> : null}
              <Small label="🗑 حذف الحقل" color={colors.danger} onPress={() => onChange(drafts.filter((x) => x.uid !== d.uid))} />
            </View>
            {expanded ? (
              <View style={{ marginTop: 12 }}>
                <Input label="الاسم بالعربية *" value={d.labelAr} onChangeText={(v) => update(d.uid, { labelAr: v })} />
                <Input label="الاسم بالإنجليزية" value={d.labelEn} onChangeText={(v) => update(d.uid, { labelEn: v })} />
                <Input label="المفتاح (key)" value={d.key} editable={d.isNew} autoCapitalize="none"
                  onChangeText={(v) => update(d.uid, { key: v.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                  hint={d.isNew ? 'بالإنجليزية، مثل storage_location' : 'ثابت — تُحفظ به القيم في السجلات السابقة'} />
                <Text style={styles.label}>نوع الحقل</Text>
                <Chips value={d.type} onChange={(v) => update(d.uid, { type: v })} options={TYPES} />
                <Toggle label="إلزامي" value={d.required} onChange={(v) => update(d.uid, { required: v })} />
                <Toggle label="حرج — الانحراف ينبه فوراً ويفتح CAPA عاجلاً" value={d.critical} onChange={(v) => update(d.uid, { critical: v })} />
                {d.type === 'number' ? (
                  <>
                    <Input label="الوحدة" value={d.unit} onChangeText={(v) => update(d.uid, { unit: v })} placeholder="°C, %, kg" />
                    <View style={styles.row}>
                      <View style={{ flex: 1 }}><Input label="الحد الحرج الأدنى" value={d.min} onChangeText={(v) => update(d.uid, { min: v })} keyboardType="numbers-and-punctuation" /></View>
                      <View style={{ flex: 1 }}><Input label="الحد الحرج الأعلى" value={d.max} onChangeText={(v) => update(d.uid, { max: v })} keyboardType="numbers-and-punctuation" /></View>
                    </View>
                    <View style={styles.row}>
                      <View style={{ flex: 1 }}><Input label="أقل قيمة مسموحة (رفض)" value={d.validMin} onChangeText={(v) => update(d.uid, { validMin: v })} keyboardType="numbers-and-punctuation" /></View>
                      <View style={{ flex: 1 }}><Input label="أعلى قيمة مسموحة (رفض)" value={d.validMax} onChangeText={(v) => update(d.uid, { validMax: v })} keyboardType="numbers-and-punctuation" /></View>
                    </View>
                  </>
                ) : null}
                {d.type === 'select' ? (
                  <Input label="الخيارات (كل خيار في سطر)" value={d.options} onChangeText={(v) => update(d.uid, { options: v })} multiline
                    style={{ minHeight: 90, textAlignVertical: 'top' }} />
                ) : null}
                {d.type === 'boolean' ? (
                  <>
                    <Text style={styles.label}>الإجابة المطابقة</Text>
                    <Chips value={d.expected} onChange={(v) => update(d.uid, { expected: v })}
                      options={[{ value: 'yes', label: 'نعم' }, { value: 'no', label: 'لا' }, { value: 'none', label: 'لا يوجد' }]} />
                  </>
                ) : null}
                <Input label="ملاحظة للموظف" value={d.hint} onChangeText={(v) => update(d.uid, { hint: v })} />
                <Input label="قواعد متقدمة (JSON)" value={d.advanced} onChangeText={(v) => update(d.uid, { advanced: v })} multiline autoCapitalize="none"
                  style={{ minHeight: 90, fontFamily: 'monospace', fontSize: 12, textAlignVertical: 'top', textAlign: 'left', writingDirection: 'ltr' }}
                  placeholder='{"limitsBy":{"field":"zone_type","cases":{"تبريد":{"min":2,"max":8}}}}'
                  hint="limitsBy · compute · after · unique · uniqueWith · carryFrom · carryMatch · prefill · onCriticalDeviation · companyOptions · optionLabels · pattern" />
              </View>
            ) : null}
          </Card>
        );
      })}
      <Pressable
        onPress={() => {
          const uid = `f${++seq}`;
          onChange([...drafts, { uid, isNew: true, key: `field_${drafts.length + 1}`, labelAr: '', labelEn: '', type: 'text', required: false, critical: false,
            unit: '', min: '', max: '', validMin: '', validMax: '', options: '', expected: 'none', hint: '', advanced: '' }]);
          setOpen(uid);
        }}
        style={{ borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.primary, borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 12 }}
      >
        <Text style={{ color: colors.primary, fontWeight: '800', textAlign: textStart }}>➕ إضافة حقل</Text>
      </Pressable>
    </View>
  );
}
