import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import type { InternalAudit } from '@/api/types';
import { Badge, Button, Card, Empty, Input, Loading, styles } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { colors, departmentLabel, textStart } from '@/theme';

type Answer = { compliant?: boolean; note: string };

/** Conducting an internal audit: every non-compliant item becomes a finding with its own CAPA. */
export default function AuditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useAuth();
  const { data: audit, error, setData } = useApi<InternalAudit>(`/internal-audits/${id}`);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (audit?.items) {
      setAnswers(Object.fromEntries(audit.items.map((it) => [it.id, { compliant: it.compliant ?? undefined, note: it.note ?? '' }])));
    }
  }, [audit?.id, audit?.status]);

  if (error) return <Empty text={error} />;
  if (!audit) return <Loading />;

  const editable = audit.status === 'PLANNED' && can('internal-audit:manage');
  const items = audit.items ?? [];
  const answered = items.filter((it) => answers[it.id]?.compliant !== undefined).length;
  const missingNotes = items.filter((it) => answers[it.id]?.compliant === false && !answers[it.id]?.note.trim()).length;
  const set = (itemId: string, patch: Partial<Answer>) =>
    setAnswers((a) => ({ ...a, [itemId]: { ...a[itemId], ...patch, note: patch.note ?? a[itemId]?.note ?? '' } }));

  const submit = async () => {
    setBusy(true);
    setSubmitError(null);
    try {
      const result = await api<InternalAudit>(`/internal-audits/${id}/complete`, {
        method: 'POST',
        body: {
          items: items.map((it) => ({ id: it.id, compliant: answers[it.id]!.compliant, note: answers[it.id]!.note.trim() || undefined })),
          summary: summary.trim() || undefined,
        },
      });
      setData(result);
    } catch (e) {
      setSubmitError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Card>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text style={[styles.title, { flex: 1 }]}>{audit.title}</Text>
          {audit.status === 'COMPLETED' ? <Badge text={`النتيجة ${audit.score}%`} color={(audit.score ?? 0) >= 90 ? colors.success : colors.warning} /> : null}
        </View>
        <Text style={styles.muted}>
          {audit.audit_no} · {departmentLabel[audit.department_code]} · {audit.scheduled_date} · المدقق: {audit.auditor_name}
        </Text>
        {editable ? <Text style={[styles.muted, { marginTop: 4 }]}>تمت الإجابة على {answered} من {items.length}</Text> : null}
        {audit.status === 'COMPLETED' && audit.findings > 0 ? (
          <Button title={`عرض الملاحظات (${audit.findings}) وإجراءاتها التصحيحية`} variant="outline" onPress={() => router.push('/incidents')} />
        ) : null}
      </Card>

      {items.map((it, index) => {
        const a = answers[it.id];
        return (
          <Card key={it.id} style={a?.compliant === false ? { borderColor: colors.danger } : undefined}>
            <Text style={styles.muted}>{index + 1}. {it.id} · {it.clause}</Text>
            <Text style={[styles.body, { marginVertical: 6, fontWeight: '600' }]}>{it.question}</Text>
            <View style={styles.row}>
              {([[true, 'مطابق ✓', colors.success], [false, 'غير مطابق ✗', colors.danger]] as const).map(([value, label, c]) => (
                <Pressable
                  key={label}
                  disabled={!editable}
                  onPress={() => set(it.id, { compliant: value })}
                  style={{
                    flex: 1, padding: 10, borderRadius: 10, borderWidth: 1.5, alignItems: 'center',
                    borderColor: a?.compliant === value ? c : colors.border, backgroundColor: a?.compliant === value ? `${c}1A` : '#fff',
                  }}
                >
                  <Text style={{ color: a?.compliant === value ? c : colors.text, fontWeight: '700' }}>{label}</Text>
                </Pressable>
              ))}
            </View>
            {a?.compliant === false ? (
              <View style={{ marginTop: 10 }}>
                <Input value={a.note} onChangeText={(note) => set(it.id, { note })} editable={editable} multiline
                  placeholder="الملاحظة والدليل (إلزامي) — ستتحول إلى إجراء تصحيحي" />
              </View>
            ) : null}
          </Card>
        );
      })}

      {editable ? (
        <Card>
          <Input label="ملخص التدقيق (اختياري)" value={summary} onChangeText={setSummary} multiline style={{ minHeight: 70 }} />
          {submitError ? <Text style={{ color: colors.danger, marginBottom: 8, textAlign: textStart }}>{submitError}</Text> : null}
          <Button title="اعتماد نتيجة التدقيق" onPress={submit} loading={busy} disabled={answered < items.length || missingNotes > 0} />
          {missingNotes > 0 ? <Text style={[styles.muted, { textAlign: 'center' }]}>أضف الملاحظة لكل بند غير مطابق ({missingNotes})</Text> : null}
        </Card>
      ) : audit.summary ? (
        <Card>
          <Text style={styles.title}>الملخص</Text>
          <Text style={styles.body}>{audit.summary}</Text>
        </Card>
      ) : null}
    </ScrollView>
  );
}
