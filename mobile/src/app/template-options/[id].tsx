import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { api, errorMessage } from '@/api/client';
import type { FormTemplateSummary } from '@/api/types';
import { Button, Card, Empty, Input, Loading, styles } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { colors, textStart } from '@/theme';

/** Company-maintained lists of a form (e.g. the approved supplier list of inbound receiving). */
export default function TemplateOptionsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: t, error, setData } = useApi<FormTemplateSummary>(`/haccp/templates/${id}`);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const lists = t?.fields.filter((f) => f.companyOptions) ?? [];
  useEffect(() => {
    if (t) setDrafts(Object.fromEntries(t.fields.filter((f) => f.companyOptions).map((f) => [f.key, (f.options ?? []).join('\n')])));
  }, [t]);

  if (error) return <Empty text={error} />;
  if (!t) return <Loading />;
  if (!lists.length) return <Empty text="لا توجد قوائم تديرها الشركة في هذا النموذج" />;

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={styles.title}>{t.title_ar}</Text>
        <Text style={styles.muted}>اكتب كل قيمة في سطر. تظهر القائمة للموظفين عند تعبئة النموذج، ولا تُقبل قيمة خارجها.</Text>
      </Card>
      {message ? <Text style={{ color: message.ok ? colors.success : colors.danger, marginBottom: 8, textAlign: textStart }}>{message.text}</Text> : null}
      {lists.map((f) => (
        <Card key={f.key}>
          <Input label={`${f.labelAr} (${(drafts[f.key] ?? '').split('\n').filter((x) => x.trim()).length})`} value={drafts[f.key] ?? ''}
            onChangeText={(v) => setDrafts((d) => ({ ...d, [f.key]: v }))} multiline style={{ minHeight: 160, textAlignVertical: 'top' }}
            hint={f.hint} />
          <Button title="حفظ القائمة" loading={busy === f.key} onPress={async () => {
            const options = [...new Set((drafts[f.key] ?? '').split('\n').map((x) => x.trim()).filter(Boolean))];
            setBusy(f.key);
            setMessage(null);
            try {
              setData(await api<FormTemplateSummary>(`/haccp/templates/${id}/options`, { method: 'PUT', body: { field: f.key, options } }));
              setMessage({ text: `تم حفظ قائمة "${f.labelAr}" (${options.length})`, ok: true });
            } catch (e) {
              setMessage({ text: errorMessage(e), ok: false });
            } finally {
              setBusy(null);
            }
          }} />
        </Card>
      ))}
    </ScrollView>
  );
}
