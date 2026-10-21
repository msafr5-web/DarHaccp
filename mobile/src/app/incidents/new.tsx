import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { api, errorMessage } from '@/api/client';
import type { Department, Incident } from '@/api/types';
import { Button, Card, Chips, Input, styles } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { INCIDENT_TYPES, SEVERITIES } from '@/constants';
import { colors, departmentLabel, textStart } from '@/theme';

const DEPARTMENTS: Department[] = ['HOT', 'COLD', 'SWEETS', 'SUPPORT'];

export default function NewIncidentScreen() {
  const { user, can } = useAuth();
  const [type, setType] = useState<(typeof INCIDENT_TYPES)[number]['value']>('NON_CONFORMITY');
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]['value']>('MEDIUM');
  const [department, setDepartment] = useState<Department | null>(user?.department_code ?? null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!department) return;
    setBusy(true);
    setError(null);
    try {
      const incident = await api<Incident>('/incidents', {
        method: 'POST',
        body: { type, severity, department, title: title.trim(), description: description.trim(), location: location.trim() || undefined },
      });
      router.replace(can('incident:read') ? { pathname: '/incidents/[id]', params: { id: incident.id } } : '/modules');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={styles.label}>نوع البلاغ</Text>
        <Chips options={INCIDENT_TYPES} value={type} onChange={setType} />
        <Text style={styles.label}>الخطورة</Text>
        <Chips options={SEVERITIES} value={severity} onChange={setSeverity} />
        {!user?.department_code ? (
          <>
            <Text style={styles.label}>القسم</Text>
            <Chips options={DEPARTMENTS.map((d) => ({ value: d, label: departmentLabel[d] }))} value={department} onChange={setDepartment} />
          </>
        ) : null}
        <Input label="عنوان مختصر *" value={title} onChangeText={setTitle} placeholder="مثال: ثلاجة الحلويات لا تبرد" />
        <Input label="الوصف التفصيلي *" value={description} onChangeText={setDescription} multiline style={{ minHeight: 100 }}
          placeholder="ماذا حدث؟ متى؟ ما المنتجات أو الأشخاص المتأثرون؟" />
        <Input label="الموقع (اختياري)" value={location} onChangeText={setLocation} />
      </Card>
      {severity === 'HIGH' || severity === 'CRITICAL' ? (
        <Text style={[styles.body, { color: colors.danger, marginBottom: 8, textAlign: textStart }]}>
          سيُرسل تنبيه فوري لمسؤولي الجودة والمشرف عند الحفظ.
        </Text>
      ) : null}
      {error ? <Text style={{ color: colors.danger, marginBottom: 8, textAlign: textStart }}>{error}</Text> : null}
      <Button title="إرسال البلاغ" onPress={submit} loading={busy} disabled={!department || title.trim().length < 5 || description.trim().length < 10} />
    </ScrollView>
  );
}
