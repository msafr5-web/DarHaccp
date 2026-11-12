import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import { Badge, Button, Card, Empty, Input, Loading, styles } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { colors, textStart } from '@/theme';

interface PlatformAdmin {
  id: string;
  employee_no: string;
  full_name: string;
  email: string;
  is_active: boolean;
  last_login_at: string | null;
}

/** Platform administrators: full platform permissions; each signs in with e-mail → link + code. */
export default function PlatformAdminsScreen() {
  const { user } = useAuth();
  const { data, error, loading, reload, setData } = useApi<PlatformAdmin[]>('/platform/admins');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  if (error) return <Empty text={error} />;
  if (!data) return <Loading />;

  const add = async () => {
    setBusy('add');
    setMsg(null);
    try {
      const a = await api<PlatformAdmin>('/platform/admins', { method: 'POST', body: { fullName: fullName.trim(), email: email.trim() } });
      setData([...data, a]);
      setFullName('');
      setEmail('');
      setMsg({ text: `أُضيف ${a.full_name} مديراً للمنصة وأُرسل إشعار إلى ${a.email}`, ok: true });
    } catch (e) {
      setMsg({ text: errorMessage(e), ok: false });
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (a: PlatformAdmin) => {
    setBusy(a.id);
    setMsg(null);
    try {
      const u = await api<PlatformAdmin>(`/platform/admins/${a.id}`, { method: 'PATCH', body: { isActive: !a.is_active } });
      setData(data.map((x) => (x.id === a.id ? u : x)));
    } catch (e) {
      setMsg({ text: errorMessage(e), ok: false });
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}>
      <Card style={{ backgroundColor: colors.primaryLight }}>
        <Text style={styles.body}>
          مدير المنصة يملك كل الصلاحيات: مراجعة الشركات واعتمادها وتعديل بياناتها، ومكتبة النماذج، ودليل الشهادة الصحية، وسجل محاولات الدخول، وإدارة مديري المنصة.
          يدخل ببريده فقط (رابط ورمز يصلان إليه)، لذلك يجب أن يكون صندوق البريد حقيقياً وتحت سيطرته.
        </Text>
      </Card>

      <Card style={{ borderColor: colors.primary }}>
        <Text style={styles.title}>إضافة مدير منصة</Text>
        <Input label="الاسم الكامل *" value={fullName} onChangeText={setFullName} />
        <Input label="البريد الإلكتروني *" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="name@company.com"
          hint="لا يجوز أن يكون مستخدماً في أي شركة أو حساب آخر" />
        {msg ? <Text style={{ color: msg.ok ? colors.success : colors.danger, marginBottom: 8, textAlign: textStart }}>{msg.text}</Text> : null}
        <Button title="إضافة" loading={busy === 'add'} disabled={fullName.trim().length < 2 || !email.includes('@')} onPress={() => void add()} />
      </Card>

      {data.map((a) => (
        <Card key={a.id} style={{ opacity: a.is_active ? 1 : 0.6 }}>
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <Text style={[styles.body, { fontWeight: '800', flex: 1 }]}>{a.full_name}</Text>
            <Badge text={a.is_active ? 'نشط' : 'موقوف'} color={a.is_active ? colors.success : colors.danger} />
          </View>
          <Text style={[styles.muted, { writingDirection: 'ltr' }]} selectable>{a.email}</Text>
          <Text style={styles.muted}>{a.employee_no} · آخر دخول: {a.last_login_at ? new Date(a.last_login_at).toLocaleString('ar-SA') : 'لم يدخل بعد'}</Text>
          {a.email.toLowerCase() === user?.email?.toLowerCase() ? <Text style={[styles.muted, { marginTop: 4 }]}>(حسابك)</Text> : (
            <Button title={a.is_active ? 'إيقاف' : 'إعادة تفعيل'} variant={a.is_active ? 'danger' : 'outline'} loading={busy === a.id} onPress={() => void toggle(a)} />
          )}
        </Card>
      ))}
    </ScrollView>
  );
}
