import { useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import type { Department, RecordAccess, Role, User } from '@/api/types';
import { Badge, Button, Card, Chips, Empty, Input, styles } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { colors, departmentLabel, roleLabel, textStart } from '@/theme';

const ROLES: Role[] = ['CHEF', 'KITCHEN_SUPERVISOR', 'HACCP_OFFICER', 'HSE_OFFICER', 'ADMIN'];
const DEPTS: Department[] = ['HOT', 'COLD', 'SWEETS', 'SUPPORT'];
const CROSS: Role[] = ['ADMIN', 'HACCP_OFFICER', 'HSE_OFFICER'];

const ACCESS: Record<RecordAccess, { label: string; color: string }> = {
  FILL: { label: '📝 تعبئة فقط', color: colors.warning },
  FILL_EDIT: { label: '✏️ تعبئة وتعديل', color: colors.primary },
};

function NewEmployee({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [employeeNo, setEmployeeNo] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('CHEF');
  const [department, setDepartment] = useState<Department>('SUPPORT');
  const [access, setAccess] = useState<RecordAccess>('FILL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return <Button title="➕ إضافة موظف" onPress={() => setOpen(true)} />;
  const needsDept = !CROSS.includes(role);
  return (
    <Card style={{ borderColor: colors.primary }}>
      <Text style={styles.title}>موظف جديد</Text>
      <Text style={[styles.muted, { marginBottom: 10 }]}>يدخل الموظف ببريده الإلكتروني فقط (رابط ورمز يصلان إلى بريده).</Text>
      <Input label="الرقم الوظيفي *" value={employeeNo} onChangeText={setEmployeeNo} />
      <Input label="الاسم الكامل *" value={fullName} onChangeText={setFullName} />
      <Input label="البريد الإلكتروني *" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <Text style={styles.label}>الدور</Text>
      <Chips value={role} onChange={setRole} options={ROLES.map((r) => ({ value: r, label: roleLabel[r] }))} />
      {needsDept ? (
        <>
          <Text style={styles.label}>القسم</Text>
          <Chips value={department} onChange={setDepartment} options={DEPTS.map((d) => ({ value: d, label: departmentLabel[d] }))} />
        </>
      ) : null}
      <Text style={styles.label}>صلاحية السجلات</Text>
      <Chips value={access} onChange={setAccess} options={(Object.keys(ACCESS) as RecordAccess[]).map((a) => ({ value: a, ...ACCESS[a] }))} />
      {error ? <Text style={{ color: colors.danger, marginBottom: 8, textAlign: textStart }}>{error}</Text> : null}
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Button title="حفظ" loading={busy} disabled={!employeeNo.trim() || fullName.trim().length < 2 || !email.includes('@')}
            onPress={async () => {
              setBusy(true);
              setError(null);
              try {
                await api('/users', { method: 'POST', body: {
                  employeeNo: employeeNo.trim(), fullName: fullName.trim(), email: email.trim(), role,
                  department: needsDept ? department : undefined, recordAccess: access,
                } });
                setOpen(false);
                setEmployeeNo(''); setFullName(''); setEmail('');
                onCreated();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }} />
        </View>
        <View style={{ flex: 1 }}><Button title="إلغاء" variant="outline" onPress={() => setOpen(false)} /></View>
      </View>
    </Card>
  );
}

/** Company administrator: employees, their role and whether they may only fill or also amend records. */
export default function UsersScreen() {
  const { user: me } = useAuth();
  const [search, setSearch] = useState('');
  const q = new URLSearchParams({ pageSize: '200', ...(search.trim() ? { search: search.trim() } : {}) });
  const { data, error, loading, reload, setData } = useApi<User[]>(`/users?${q}`);
  const [rowError, setRowError] = useState<string | null>(null);

  const patch = async (u: User, body: Record<string, unknown>) => {
    setRowError(null);
    try {
      const updated = await api<User>(`/users/${u.id}`, { method: 'PATCH', body });
      setData((data ?? []).map((x) => (x.id === u.id ? { ...x, ...updated } : x)));
    } catch (e) {
      setRowError(errorMessage(e));
    }
  };

  return (
    <FlatList
      contentContainerStyle={styles.page}
      data={(data ?? []).filter((u) => u.employee_no !== 'SYS-IOT')}
      keyExtractor={(u) => u.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      ListHeaderComponent={
        <View>
          <Card style={{ backgroundColor: colors.primaryLight }}>
            <Text style={styles.body}>
              <Text style={{ fontWeight: '800' }}>تعبئة فقط:</Text> يعبئ النماذج ولا يعدّل بعد الحفظ.{'\n'}
              <Text style={{ fontWeight: '800' }}>تعبئة وتعديل:</Text> يصحح سجلاته بسبب مكتوب، وتبقى النسخة الأصلية محفوظة.
            </Text>
          </Card>
          <NewEmployee onCreated={reload} />
          <View style={{ height: 10 }} />
          <Input placeholder="بحث بالاسم أو الرقم الوظيفي أو البريد" value={search} onChangeText={setSearch} />
          {error || rowError ? <Text style={{ color: colors.danger, marginBottom: 12, textAlign: textStart }}>{error ?? rowError}</Text> : null}
        </View>
      }
      ListEmptyComponent={loading ? undefined : <Empty text="لا يوجد موظفون" />}
      renderItem={({ item }) => {
        const access = item.role === 'ADMIN' ? 'FILL_EDIT' : item.record_access ?? 'FILL';
        return (
          <Card style={{ opacity: item.is_active === false ? 0.6 : 1 }}>
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Text style={[styles.body, { fontWeight: '800', flex: 1 }]}>{item.full_name}</Text>
              <Badge text={ACCESS[access].label} color={ACCESS[access].color} />
            </View>
            <Text style={styles.muted}>
              {item.employee_no} · {roleLabel[item.role] ?? item.role}{item.department_code ? ` · ${departmentLabel[item.department_code]}` : ''} · {item.email}
            </Text>
            {item.is_active === false ? <Text style={[styles.muted, { color: colors.danger }]}>الحساب معطّل</Text> : null}
            {item.id !== me?.id ? (
              <View style={[styles.row, { marginTop: 8, flexWrap: 'wrap' }]}>
                {item.role !== 'ADMIN' ? (
                  <View style={{ flex: 1, minWidth: 150 }}>
                    <Button title={access === 'FILL' ? 'السماح بالتعديل' : 'تعبئة فقط'} variant="outline"
                      onPress={() => void patch(item, { recordAccess: access === 'FILL' ? 'FILL_EDIT' : 'FILL' })} />
                  </View>
                ) : null}
                <View style={{ flex: 1, minWidth: 150 }}>
                  <Button title={item.is_active === false ? 'تفعيل الحساب' : 'تعطيل الحساب'} variant={item.is_active === false ? 'outline' : 'danger'}
                    onPress={() => void patch(item, { isActive: item.is_active === false })} />
                </View>
              </View>
            ) : <Text style={[styles.muted, { marginTop: 6 }]}>(حسابك)</Text>}
          </Card>
        );
      }}
    />
  );
}
