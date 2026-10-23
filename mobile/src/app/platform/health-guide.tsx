import { useState } from 'react';
import { RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import type { HealthGuide, Verification } from '@/api/types';
import { dmy, VerificationBadge } from '@/components/GuideParts';
import { Badge, Button, Card, Chips, Empty, Input, Loading, styles } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { colors, textStart } from '@/theme';

type Kind = 'requirements' | 'activities' | 'tests' | 'steps';
type Row = Record<string, unknown> & { id: string; code: string; is_active: boolean; edited: boolean; verification: Verification; verified_on: string | null };

interface FieldDef { key: string; api: string; label: string; multiline?: boolean; list?: boolean; nullable?: boolean }

const KINDS: { value: Kind; label: string; title: string; fields: FieldDef[] }[] = [
  { value: 'requirements', label: 'ملخص المتطلبات', title: 'title_ar', fields: [
    { key: 'title_ar', api: 'titleAr', label: 'العنوان' }, { key: 'detail_ar', api: 'detailAr', label: 'التفصيل', multiline: true },
    { key: 'value_text', api: 'valueText', label: 'القيمة المعروضة (مثل 60 ريالاً)', nullable: true },
    { key: 'items', api: 'items', label: 'عناصر القائمة (سطر لكل عنصر، مثل المدن)', multiline: true, list: true }] },
  { value: 'activities', label: 'الأنشطة المستهدفة', title: 'name_ar', fields: [
    { key: 'name_ar', api: 'nameAr', label: 'اسم النشاط' }, { key: 'examples_ar', api: 'examplesAr', label: 'أمثلة', nullable: true },
    { key: 'keywords', api: 'keywords', label: 'كلمات تدل على النشاط في المهنة/القسم (سطر لكل كلمة)', multiline: true, list: true },
    { key: 'notes_ar', api: 'notesAr', label: 'ملاحظة', multiline: true, nullable: true }] },
  { value: 'tests', label: 'الفحوصات الطبية', title: 'name_ar', fields: [
    { key: 'name_ar', api: 'nameAr', label: 'اسم الفحص' }, { key: 'purpose_ar', api: 'purposeAr', label: 'الغرض', multiline: true }] },
  { value: 'steps', label: 'خطوات الإصدار', title: 'title_ar', fields: [
    { key: 'title_ar', api: 'titleAr', label: 'عنوان الخطوة' }, { key: 'detail_ar', api: 'detailAr', label: 'التفصيل', multiline: true }] },
];

const rowsOf = (g: HealthGuide, kind: Kind): Row[] => (kind === 'tests' ? g.tests : g[kind]) as unknown as Row[];

function ItemEditor({ kind, row, onSaved }: { kind: Kind; row: Row; onSaved: (g: HealthGuide) => void }) {
  const def = KINDS.find((k) => k.value === kind)!;
  const initial = () => Object.fromEntries(def.fields.map((f) => [f.api, f.list ? ((row[f.key] as string[]) ?? []).join('\n') : String(row[f.key] ?? '')]));
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<Record<string, string>>(initial);
  const [verification, setVerification] = useState<Verification>(row.verification);
  const [active, setActive] = useState(row.is_active);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const body: Record<string, unknown> = { verification, isActive: active };
    for (const f of def.fields) {
      const raw = v[f.api] ?? '';
      body[f.api] = f.list ? raw.split('\n').map((x) => x.trim()).filter(Boolean) : f.nullable && !raw.trim() ? null : raw.trim();
    }
    try {
      onSaved(await api<HealthGuide>(`/platform/health-guide/${kind}/${row.id}`, { method: 'PATCH', body }));
      setMsg({ text: 'تم الحفظ وتحديث تاريخ التحقق', ok: true });
    } catch (e) {
      setMsg({ text: errorMessage(e), ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ opacity: row.is_active ? 1 : 0.55, borderColor: open ? colors.primary : colors.border }}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Text style={[styles.body, { fontWeight: '800', flex: 1 }]} onPress={() => setOpen(!open)}>{String(row[def.title])}</Text>
        <VerificationBadge v={row.verification} />
      </View>
      <Text style={styles.muted}>
        {row.code} · تحقق {dmy(row.verified_on)}{row.edited ? ' · معدَّل من الإدارة (محمي من التحديث التلقائي)' : ''}{row.is_active ? '' : ' · موقوف'}
      </Text>
      {!open ? <Text style={{ color: colors.primary, fontWeight: '700', marginTop: 4 }} onPress={() => setOpen(true)}>✏️ تعديل</Text> : (
        <View style={{ marginTop: 10 }}>
          {def.fields.map((f) => (
            <Input key={f.api} label={f.label} value={v[f.api] ?? ''} onChangeText={(t) => setV((s) => ({ ...s, [f.api]: t }))}
              multiline={f.multiline} style={f.multiline ? { minHeight: 90, textAlignVertical: 'top' } : undefined} />
          ))}
          <Text style={styles.label}>مستوى الموثوقية</Text>
          <Chips value={verification} onChange={setVerification} options={[
            { value: 'OFFICIAL', label: 'رسمي', color: colors.success }, { value: 'REPORTED', label: 'منقول — غير رسمي', color: colors.warning },
            { value: 'UNVERIFIED', label: 'غير مؤكَّد', color: colors.danger }]} />
          <View style={[styles.row, { justifyContent: 'space-between', marginBottom: 10 }]}>
            <Text style={styles.body}>{active ? 'ظاهر للشركات' : 'مخفي عن الشركات'}</Text>
            <Switch value={active} onValueChange={setActive} trackColor={{ true: colors.primary }} />
          </View>
          {msg ? <Text style={{ color: msg.ok ? colors.success : colors.danger, marginBottom: 8, textAlign: textStart }}>{msg.text}</Text> : null}
          <View style={styles.row}>
            <View style={{ flex: 1 }}><Button title="حفظ" loading={busy} onPress={() => void save()} /></View>
            <View style={{ flex: 1 }}><Button title="إغلاق" variant="outline" onPress={() => setOpen(false)} /></View>
          </View>
        </View>
      )}
    </Card>
  );
}

/** Platform administrator: keeps the health certificate guide current when Balady or an Amana changes a rule. */
export default function PlatformHealthGuideScreen() {
  const { data, error, loading, reload, setData } = useApi<HealthGuide>('/platform/health-guide');
  const [kind, setKind] = useState<Kind>('requirements');
  if (error) return <Empty text={error} />;
  if (!data) return <Loading />;
  const rows = rowsOf(data, kind);

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}>
      <Card style={{ backgroundColor: colors.primaryLight }}>
        <Text style={styles.body}>
          محتوى «دليل الشهادة الصحية» الذي يراه كل مشترك. عدّل أي بند عندما تتغير القاعدة في بلدي أو لدى أمانة، فيُسجَّل تاريخ التحقق ويصبح البند محمياً من التحديث التلقائي عند نشر نسخة جديدة. المصادر وأكواد البنود ثابتة.
        </Text>
        <Badge text={`آخر تحقق: ${dmy(data.lastVerified)}`} color={colors.primary} />
      </Card>
      <Chips value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k.value, label: `${k.label} (${rowsOf(data, k.value).length})` }))} />
      {rows.map((r) => <ItemEditor key={`${kind}-${r.id}`} kind={kind} row={r} onSaved={setData} />)}
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}
