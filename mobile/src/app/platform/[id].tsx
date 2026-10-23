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

/** Correct the company's details. The company code stays fixed (it is in the login link already sent). */
function EditDetails({ t, onSaved }: { t: TenantDetails; onSaved: (updated: TenantDetails) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(t.name);
  const [phone, setPhone] = useState(t.phone);
  const [email, setEmail] = useState(t.email);
  const [address, setAddress] = useState(t.address);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  if (!open) {
    return (
      <View>
        {message ? <Text style={{ color: message.ok ? colors.success : colors.danger, marginBottom: 6, textAlign: textStart }}>✓ {message.text}</Text> : null}
        <Button title="✏️ تعديل بيانات الشركة" variant="outline" onPress={() => {
          // Start from the latest saved values.
          setName(t.name); setPhone(t.phone); setEmail(t.email); setAddress(t.address);
          setOpen(true); setMessage(null);
        }} />
      </View>
    );
  }

  // Only send what actually changed.
  const changes = Object.fromEntries(
    Object.entries({ name, phone, email, address }).filter(([k, v]) => v.trim() !== String(t[k as keyof TenantDetails] ?? '')),
  );
  const emailChanged = email.trim().toLowerCase() !== t.email.toLowerCase();

  return (
    <Card style={{ borderColor: colors.primary }}>
      <Text style={styles.title}>تعديل بيانات الشركة</Text>
      <Text style={[styles.muted, { marginBottom: 10 }]}>رمز الشركة ({t.code}) ثابت منذ الاشتراك ولا يتغيّر.</Text>
      <Input label="اسم الشركة" value={name} onChangeText={setName} />
      <Input label="رقم الجوال" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="05XXXXXXXX" />
      <Input label="البريد الإلكتروني الرسمي" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
        hint={emailChanged ? 'سيصبح هذا البريد بريد دخول مدير الشركة، ويُرسل إشعار للبريد القديم والجديد.' : undefined} />
      <Input label="العنوان" value={address} onChangeText={setAddress} multiline />
      {message ? <Text style={{ color: message.ok ? colors.success : colors.danger, marginBottom: 8, textAlign: textStart }}>{message.text}</Text> : null}
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Button title="حفظ التعديلات" loading={busy} disabled={!Object.keys(changes).length}
            onPress={async () => {
              setBusy(true);
              setMessage(null);
              try {
                const updated = await api<TenantDetails>(`/platform/tenants/${t.id}`, { method: 'PATCH', body: changes });
                onSaved(updated);
                setMessage({ text: emailChanged ? 'تم الحفظ — أُبلغ البريدان القديم والجديد بالتغيير' : 'تم حفظ التعديلات', ok: true });
                setOpen(false);
              } catch (e) {
                setMessage({ text: errorMessage(e), ok: false });
              } finally {
                setBusy(false);
              }
            }} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="إلغاء" variant="outline" onPress={() => {
            setName(t.name); setPhone(t.phone); setEmail(t.email); setAddress(t.address); setOpen(false); setMessage(null);
          }} />
        </View>
      </View>
    </Card>
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

      <EditDetails t={t} onSaved={(u) => setData({ ...t, ...u })} />
      <View style={{ height: 6 }} />

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
            <Button title="✅ اعتماد الشركة وإرسال رابط الدخول" loading={busy}
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
            <Button title="✉️ إعادة إرسال رابط الدخول للشركة" variant="outline" loading={busy}
              onPress={() => act('resend-activation', {}, 'تم إرسال رابط الدخول إلى بريد الشركة')} />
            <Button title="⏸ إيقاف الحساب" variant="danger" loading={busy} disabled={notes.trim().length < 5}
              onPress={() => act('suspend', { reason: notes.trim() }, 'تم إيقاف الحساب — تم قطع جلسات الشركة')} />
          </>
        ) : null}
        {t.status === 'REJECTED' ? (
          <Button title="↺ إعادة فتح الطلب للمراجعة" variant="outline" loading={busy}
            onPress={() => act('reopen', { notes: notes.trim() || undefined }, 'أُعيد الطلب إلى قائمة المراجعة')} />
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
