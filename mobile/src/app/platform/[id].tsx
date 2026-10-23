import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import type { TenantDetails } from '@/api/types';
import { Badge, Button, Card, Empty, Input, Loading, styles } from '@/components/ui';
import { TENANT_STATUS } from '@/constants';
import { useApi } from '@/hooks/useApi';
import { colors, textStart } from '@/theme';

function Row({ label, value, ltr }: { label: string; value: string | number | null | undefined; ltr?: boolean }) {
  return (
    <View style={[styles.row, { justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderColor: '#F2F4F7' }]}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={[styles.body, { fontWeight: '700', flexShrink: 1 }, ltr && { writingDirection: 'ltr' }]} selectable>{value ?? '—'}</Text>
    </View>
  );
}

/** Company review: verify the submitted information, then approve, reject, suspend or reactivate. */
export default function TenantReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: t, error, setData } = useApi<TenantDetails>(`/platform/tenants/${id}`);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  if (error) return <Empty text={error} />;
  if (!t) return <Loading />;

  const act = async (path: string, body: object, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const updated = await api<TenantDetails>(`/platform/tenants/${id}/${path}`, { method: 'POST', body });
      if (updated?.status) setData({ ...t, ...updated });
      setMessage({ text: done, ok: true });
      setNotes('');
    } catch (e) {
      setMessage({ text: errorMessage(e), ok: false });
    } finally {
      setBusy(false);
    }
  };

  const status = TENANT_STATUS[t.status];

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Card>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text style={[styles.title, { flex: 1 }]}>{t.name}</Text>
          <Badge text={status.label} color={status.color} />
        </View>
        <Row label="رمز الشركة" value={t.code} ltr />
        <Row label="الرقم التعريفي" value={t.account_no} />
        <Row label="الجوال" value={t.phone} ltr />
        <Row label="البريد الإلكتروني" value={t.email} ltr />
        <Row label="العنوان" value={t.address} />
        <Row label="تاريخ الاشتراك" value={t.subscription_date} />
        <Row label="تأكيد البريد" value={t.email_verified_at ? `✓ ${new Date(t.email_verified_at).toLocaleString('ar-SA')}` : 'لم يُؤكَّد بعد'} />
        <Row label="تاريخ التسجيل" value={new Date(t.created_at).toLocaleString('ar-SA')} />
        {t.reviewed_at ? <Row label="آخر مراجعة" value={`${new Date(t.reviewed_at).toLocaleString('ar-SA')} — ${t.reviewed_by_name ?? ''}`} /> : null}
        {t.review_notes ? <Row label="ملاحظات المراجعة" value={t.review_notes} /> : null}
        {t.status === 'ACTIVE' ? <Row label="المستخدمون / السجلات" value={`${t.users_count} / ${t.records_count}`} /> : null}
      </Card>

      <Card>
        <Text style={styles.title}>قائمة التحقق قبل الاعتماد</Text>
        {['اسم الشركة مطابق للسجل التجاري', 'رقم الجوال صحيح ويخص الشركة', 'البريد الإلكتروني رسمي ومؤكَّد', 'العنوان واضح وكامل',
          'رمز الشركة مطابق للقاعدة (5 أحرف + آخر 5 أرقام + التاريخ)'].map((c) => (
          <Text key={c} style={[styles.body, { marginTop: 4 }]}>☐ {c}</Text>
        ))}
      </Card>

      <Card>
        <Input label="ملاحظات / سبب القرار" value={notes} onChangeText={setNotes} multiline style={{ minHeight: 70 }}
          placeholder="مطلوب عند الرفض أو الإيقاف" />
        {message ? <Text style={{ color: message.ok ? colors.success : colors.danger, marginBottom: 8, textAlign: textStart }}>{message.text}</Text> : null}

        {t.status === 'PENDING_REVIEW' ? (
          <>
            <Button title="✅ اعتماد الشركة وإرسال رابط التفعيل" loading={busy}
              onPress={() => act('approve', { notes: notes.trim() || undefined }, 'تم الاعتماد وأُرسل البريد للشركة')} />
            <Button title="✖ رفض الطلب" variant="danger" loading={busy} disabled={notes.trim().length < 5}
              onPress={() => act('reject', { reason: notes.trim() }, 'تم رفض الطلب وإبلاغ الشركة')} />
          </>
        ) : null}
        {t.status === 'PENDING_VERIFICATION' ? (
          <>
            <Text style={[styles.body, { color: colors.warning, marginBottom: 8 }]}>الشركة لم تؤكد بريدها بعد — لا يمكن الاعتماد قبل التأكيد.</Text>
            <Button title="✖ رفض الطلب" variant="danger" loading={busy} disabled={notes.trim().length < 5}
              onPress={() => act('reject', { reason: notes.trim() }, 'تم رفض الطلب')} />
          </>
        ) : null}
        {t.status === 'ACTIVE' ? (
          <>
            <Button title="✉️ إعادة إرسال رابط تفعيل المدير" variant="outline" loading={busy}
              onPress={() => act('resend-activation', {}, 'تم إرسال رابط التفعيل')} />
            <Button title="⏸ إيقاف الحساب" variant="danger" loading={busy} disabled={notes.trim().length < 5}
              onPress={() => act('suspend', { reason: notes.trim() }, 'تم إيقاف الحساب — تم قطع جلسات الشركة')} />
          </>
        ) : null}
        {t.status === 'SUSPENDED' ? (
          <Button title="▶ إعادة تفعيل الحساب" loading={busy} onPress={() => act('reactivate', {}, 'تمت إعادة التفعيل')} />
        ) : null}
      </Card>
      <Button title="سجل محاولات دخول هذه الشركة" variant="outline"
        onPress={() => router.push({ pathname: '/platform/attempts', params: { tenantId: String(t.id), name: t.name } })} />
    </ScrollView>
  );
}
