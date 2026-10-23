import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import type { CatalogForm, Department } from '@/api/types';
import { FieldDraft, FieldsEditor, fromDrafts, toDrafts } from '@/components/FieldsEditor';
import { Button, Card, Chips, Empty, Input, Loading, styles } from '@/components/ui';
import { CATEGORY_LABEL } from '@/constants';
import { useApi } from '@/hooks/useApi';
import { colors, departmentLabel, textStart } from '@/theme';

const DEPTS: ('ANY' | Department)[] = ['ANY', 'HOT', 'COLD', 'SWEETS', 'SUPPORT'];

/** Create or edit a library form: details, minimum frequency and fields (add / remove / rules). */
export default function CatalogFormScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const { data: form, error } = useApi<CatalogForm>(isNew ? null : `/platform/catalog/${id}`);
  const [code, setCode] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('WMS_GDP');
  const [department, setDepartment] = useState<'ANY' | Department>('ANY');
  const [minDaily, setMinDaily] = useState('0');
  const [isDefault, setIsDefault] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [drafts, setDrafts] = useState<FieldDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!form) return;
    setCode(form.code); setTitleAr(form.title_ar); setTitleEn(form.title_en); setDescription(form.description ?? '');
    setCategory(form.category); setDepartment(form.department_code ?? 'ANY'); setMinDaily(String(form.min_daily_entries));
    setIsDefault(form.is_default); setIsActive(form.is_active); setDrafts(toDrafts(form.fields));
  }, [form]);

  if (error) return <Empty text={error} />;
  if (!isNew && !form) return <Loading />;

  const save = async () => {
    const { fields, error: err } = fromDrafts(drafts);
    if (err) return setMessage({ text: err, ok: false });
    if (!fields.length) return setMessage({ text: 'أضف حقلاً واحداً على الأقل', ok: false });
    setBusy(true);
    setMessage(null);
    const body = {
      titleAr: titleAr.trim(), titleEn: titleEn.trim() || titleAr.trim(), description: description.trim() || null, category,
      department: department === 'ANY' ? null : department, fields, minDailyEntries: Number(minDaily) || 0, isDefault,
    };
    try {
      if (isNew) {
        const c = await api<CatalogForm>('/platform/catalog', { method: 'POST', body: { ...body, code: code.trim().toUpperCase() } });
        router.replace({ pathname: '/platform/forms/[id]', params: { id: c.id } });
      } else {
        const c = await api<CatalogForm>(`/platform/catalog/${id}`, { method: 'PATCH', body: { ...body, isActive } });
        setDrafts(toDrafts(c.fields));
        setMessage({ text: `تم الحفظ — الإصدار ${c.version}${c.propagated_to ? `، وتحدّث لدى ${c.propagated_to} شركة` : ''}`, ok: true });
      }
    } catch (e) {
      setMessage({ text: errorMessage(e), ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: isNew ? 'نموذج جديد' : form!.title_ar }} />
      <Card>
        {isNew ? (
          <Input label="رمز النموذج *" value={code} onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
            autoCapitalize="characters" placeholder="COLD_ROOM_CHECK" />
        ) : <Text style={[styles.muted, { marginBottom: 8 }]}>{form!.code} · الإصدار {form!.version} · مفعّل لدى {form!.companies_count ?? 0} شركة</Text>}
        <Input label="الاسم بالعربية *" value={titleAr} onChangeText={setTitleAr} />
        <Input label="الاسم بالإنجليزية" value={titleEn} onChangeText={setTitleEn} />
        <Input label="الوصف" value={description} onChangeText={setDescription} multiline />
        <Text style={styles.label}>التصنيف</Text>
        <Chips value={category} onChange={setCategory} options={Object.keys(CATEGORY_LABEL).map((c) => ({ value: c, label: CATEGORY_LABEL[c]! }))} />
        <Text style={styles.label}>القسم</Text>
        <Chips value={department} onChange={setDepartment}
          options={DEPTS.map((d) => ({ value: d, label: d === 'ANY' ? 'كل الأقسام' : departmentLabel[d] }))} />
        <Input label="الحد الأدنى للتعبئة يومياً (0 = بلا حد)" value={minDaily} onChangeText={setMinDaily} keyboardType="number-pad"
          hint="عند عدم استيفائه يُرفع تنبيه «مراقبة ناقصة» صباح اليوم التالي" />
        <View style={[styles.row, { justifyContent: 'space-between', marginBottom: 10 }]}>
          <Text style={styles.body}>يُعطى تلقائياً لكل شركة جديدة</Text>
          <Switch value={isDefault} onValueChange={setIsDefault} trackColor={{ true: colors.primary }} />
        </View>
        {!isNew ? (
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <Text style={[styles.body, !isActive && { color: colors.danger }]}>{isActive ? 'متاح في المكتبة' : 'موقوف — يُسحب من كل الشركات'}</Text>
            <Switch value={isActive} onValueChange={setIsActive} trackColor={{ true: colors.primary }} />
          </View>
        ) : null}
      </Card>

      <Text style={[styles.title, { marginVertical: 8 }]}>الحقول ({drafts.length})</Text>
      <FieldsEditor drafts={drafts} onChange={setDrafts} />

      {message ? <Text style={{ color: message.ok ? colors.success : colors.danger, marginBottom: 8, textAlign: textStart }}>{message.text}</Text> : null}
      <Button title={isNew ? 'إنشاء النموذج' : 'حفظ التعديلات'} loading={busy} disabled={titleAr.trim().length < 2 || (isNew && code.length < 3)} onPress={save} />
    </ScrollView>
  );
}
