import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import type { CatalogForm, FormField } from '@/api/types';
import { FieldDraft, FieldsEditor, fromDrafts, toDrafts } from '@/components/FieldsEditor';
import { Badge, Button, Card, Empty, Loading, styles } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { colors, textStart } from '@/theme';

interface CompanyCopy {
  id: string;
  is_active: boolean;
  customized: boolean;
  fields: FormField[];
}

/** Fields of one library form for one company (a customised copy stops following library changes until reset). */
export default function TenantFormScreen() {
  const { tenantId, catalogId, name } = useLocalSearchParams<{ tenantId: string; catalogId: string; name?: string }>();
  const { data, error, setData } = useApi<{ catalog: CatalogForm; copy: CompanyCopy | null }>(`/platform/tenants/${tenantId}/forms/${catalogId}`);
  const [drafts, setDrafts] = useState<FieldDraft[]>([]);
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (data?.copy) setDrafts(toDrafts(data.copy.fields));
  }, [data]);

  if (error) return <Empty text={error} />;
  if (!data) return <Loading />;
  if (!data.copy) return <Empty text="فعّل النموذج لهذه الشركة أولاً" />;
  const copy = data.copy;

  const run = async (kind: 'save' | 'reset') => {
    let body: object | undefined;
    if (kind === 'save') {
      const { fields, error: err } = fromDrafts(drafts);
      if (err) return setMessage({ text: err, ok: false });
      body = { fields };
    }
    setBusy(kind);
    setMessage(null);
    try {
      const updated = await api<CompanyCopy>(`/platform/tenants/${tenantId}/forms/${catalogId}/${kind === 'save' ? 'fields' : 'reset'}`, {
        method: kind === 'save' ? 'PUT' : 'POST', body,
      });
      setData({ ...data, copy: updated });
      setMessage({ text: kind === 'save' ? 'تم حفظ حقول هذه الشركة' : 'أُعيد النموذج إلى نسخة المكتبة (مع الإبقاء على قوائم الشركة)', ok: true });
    } catch (e) {
      setMessage({ text: errorMessage(e), ok: false });
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: data.catalog.title_ar }} />
      <Card>
        <Text style={styles.title}>{data.catalog.title_ar}</Text>
        <Text style={styles.muted}>{name ? `${name} · ` : ''}{data.catalog.code}</Text>
        <View style={{ marginTop: 8, alignItems: 'flex-start' }}>
          {copy.customized
            ? <Badge text="مخصص لهذه الشركة — لا يتبع تعديلات المكتبة" color={colors.warning} />
            : <Badge text="مطابق للمكتبة — يتحدث تلقائياً" color={colors.success} />}
        </View>
        <Text style={[styles.muted, { marginTop: 8 }]}>
          الحفظ هنا يغيّر النموذج لهذه الشركة فقط. السجلات السابقة تبقى بإصدارها الأصلي.
        </Text>
      </Card>

      <FieldsEditor drafts={drafts} onChange={setDrafts} />

      {message ? <Text style={{ color: message.ok ? colors.success : colors.danger, marginBottom: 8, textAlign: textStart }}>{message.text}</Text> : null}
      <Button title="حفظ حقول هذه الشركة" loading={busy === 'save'} onPress={() => void run('save')} />
      {copy.customized ? (
        <Button title="↺ إعادة إلى نموذج المكتبة" variant="outline" loading={busy === 'reset'} onPress={() => void run('reset')} />
      ) : null}
    </ScrollView>
  );
}
