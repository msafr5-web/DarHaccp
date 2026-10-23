import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import { ExcelSync } from '@/components/ExcelSync';
import { Badge, Button, Card, Chips, Empty, Input, OfflineNote, Stat, styles } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { colors, textStart } from '@/theme';

type ExamStatus = 'FIT' | 'PENDING' | 'UNFIT';
type CertStatus = 'VALID' | 'EXPIRING' | 'EXPIRED' | 'RENEWAL_REQUIRED' | 'NOT_FIT';

interface Entry {
  id: string;
  serial: number;
  branch_name: string;
  balady_license_no: string;
  internal_section: string | null;
  worker_name: string;
  id_number_masked: string;
  id_type: 'CITIZEN' | 'RESIDENT';
  birth_date: string | null;
  profession: string | null;
  mobile: string | null;
  exam_date: string | null;
  exam_status: ExamStatus;
  cert_expiry: string | null;
  cert_status: CertStatus;
  days_remaining: number | null;
  notes: string | null;
}

const EXAM: Record<ExamStatus, { label: string; color: string }> = {
  FIT: { label: 'سليم (معتمد)', color: colors.success },
  PENDING: { label: 'بانتظار النتيجة', color: colors.warning },
  UNFIT: { label: 'غير لائق', color: colors.danger },
};
const CERT: Record<CertStatus, { label: string; color: string }> = {
  VALID: { label: 'سارية', color: colors.success },
  EXPIRING: { label: 'قريب الانتهاء', color: colors.warning },
  EXPIRED: { label: 'منتهية', color: colors.danger },
  RENEWAL_REQUIRED: { label: 'تجديد مطلوب', color: '#B54708' },
  NOT_FIT: { label: 'غير لائق', color: colors.danger },
};
const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

/** The 14 columns of the establishment's Balady sheet, in order. */
const COLUMNS: { title: string; width: number; cell: (e: Entry) => string }[] = [
  { title: 'م', width: 44, cell: (e) => String(e.serial) },
  { title: 'اسم المنشأة / الفرع', width: 140, cell: (e) => e.branch_name },
  { title: 'رقم رخصة بلدي', width: 110, cell: (e) => e.balady_license_no },
  { title: 'القسم / النشاط الداخلي', width: 130, cell: (e) => e.internal_section ?? '—' },
  { title: 'اسم العامل (حسب الهوية)', width: 160, cell: (e) => e.worker_name },
  { title: 'رقم الهوية / الإقامة', width: 120, cell: (e) => `${e.id_number_masked} · ${e.id_type === 'CITIZEN' ? 'هوية' : 'إقامة'}` },
  { title: 'تاريخ الميلاد (يوم/شهر/سنة)', width: 100, cell: (e) => dmy(e.birth_date) },
  { title: 'المهنة بالرخصة', width: 120, cell: (e) => e.profession ?? '—' },
  { title: 'رقم الجوال', width: 100, cell: (e) => e.mobile ?? '—' },
  { title: 'تاريخ الفحص الطبي', width: 95, cell: (e) => dmy(e.exam_date) },
  { title: 'حالة الفحص', width: 110, cell: (e) => EXAM[e.exam_status].label },
  { title: 'تاريخ انتهاء الشهادة', width: 100, cell: (e) => dmy(e.cert_expiry) },
  { title: 'حالة الشهادة', width: 115, cell: (e) => CERT[e.cert_status].label },
  { title: 'ملاحظات التنفيذ', width: 180, cell: (e) => e.notes ?? '' },
];

function daysText(e: Entry) {
  if (e.days_remaining === null) return '';
  return e.days_remaining < 0 ? `منذ ${-e.days_remaining} يوم` : `${e.days_remaining} يوم`;
}

/** Add / edit one worker. "حالة الشهادة" is computed by the system, never typed. */
function EntryForm({ entry, branches, onDone, onCancel }: {
  entry: Entry | null; branches: { name: string; license: string }[]; onDone: (msg: string) => void; onCancel: () => void;
}) {
  const { can } = useAuth();
  const [f, setF] = useState({
    branchName: entry?.branch_name ?? branches[0]?.name ?? '', baladyLicenseNo: entry?.balady_license_no ?? branches[0]?.license ?? '',
    internalSection: entry?.internal_section ?? '', workerName: entry?.worker_name ?? '', idNumber: '',
    birthDate: entry?.birth_date ? dmy(entry.birth_date) : '', profession: entry?.profession ?? '', mobile: entry?.mobile ?? '',
    examDate: entry?.exam_date ?? '', examStatus: (entry?.exam_status ?? 'PENDING') as ExamStatus, certExpiry: entry?.cert_expiry ?? '',
    notes: entry?.notes ?? '',
  });
  const [busy, setBusy] = useState<'save' | 'delete' | 'reveal' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullId, setFullId] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setBusy('save');
    setError(null);
    const body = {
      ...f, idNumber: f.idNumber.trim() || undefined, internalSection: f.internalSection || null, profession: f.profession || null,
      mobile: f.mobile || null, birthDate: f.birthDate || null, examDate: f.examDate || null, certExpiry: f.certExpiry || null, notes: f.notes || null,
    };
    try {
      const r = entry
        ? await api<{ warnings: string[] }>(`/health-register/${entry.id}`, { method: 'PUT', body })
        : await api<{ warnings: string[] }>('/health-register', { method: 'POST', body });
      onDone(r.warnings.length ? `تم الحفظ — ملاحظة: ${r.warnings.join('، ')}` : 'تم الحفظ');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card style={{ borderColor: colors.primary }}>
      <Text style={styles.title}>{entry ? `تعديل: ${entry.worker_name}` : 'إضافة عامل إلى السجل'}</Text>
      <Text style={[styles.muted, { marginBottom: 10 }]}>حالة الشهادة تُحسب تلقائياً من حالة الفحص وتاريخ الانتهاء.</Text>
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        <View style={{ flex: 1, minWidth: 220 }}><Input label="اسم المنشأة / الفرع *" value={f.branchName} onChangeText={(v) => {
          const known = branches.find((b) => b.name === v.trim());
          setF((s) => ({ ...s, branchName: v, baladyLicenseNo: known ? known.license : s.baladyLicenseNo }));
        }} /></View>
        <View style={{ flex: 1, minWidth: 160 }}><Input label="رقم رخصة بلدي *" value={f.baladyLicenseNo} onChangeText={set('baladyLicenseNo')} keyboardType="number-pad" /></View>
      </View>
      {branches.length ? (
        <Chips value={f.branchName} onChange={(v) => setF((s) => ({ ...s, branchName: v, baladyLicenseNo: branches.find((b) => b.name === v)?.license ?? s.baladyLicenseNo }))}
          options={branches.map((b) => ({ value: b.name, label: b.name }))} />
      ) : null}
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        <View style={{ flex: 1, minWidth: 220 }}><Input label="اسم العامل (حسب الهوية) *" value={f.workerName} onChangeText={set('workerName')} /></View>
        <View style={{ flex: 1, minWidth: 220 }}>
          <Input label={entry ? 'رقم الهوية / الإقامة (اتركه فارغاً للإبقاء)' : 'رقم الهوية / الإقامة *'} value={f.idNumber} onChangeText={set('idNumber')}
            keyboardType="number-pad" placeholder={entry ? fullId ?? entry.id_number_masked : '1XXXXXXXXX أو 2XXXXXXXXX'} />
          {entry && can('staff:view-id') && !fullId ? (
            <Pressable onPress={async () => {
              setBusy('reveal');
              try { setFullId((await api<{ id_number: string }>(`/health-register/${entry.id}/id-number`)).id_number); } catch (e) { setError(errorMessage(e)); }
              finally { setBusy(null); }
            }}><Text style={{ color: colors.primary, fontWeight: '700', marginTop: -8, marginBottom: 10 }}>👁 عرض الرقم كاملاً (يُسجَّل في سجل التدقيق)</Text></Pressable>
          ) : null}
        </View>
      </View>
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        <View style={{ flex: 1, minWidth: 160 }}><Input label="تاريخ الميلاد (يوم/شهر/سنة)" value={f.birthDate} onChangeText={set('birthDate')} placeholder="15/05/1992" /></View>
        <View style={{ flex: 1, minWidth: 160 }}><Input label="رقم الجوال" value={f.mobile} onChangeText={set('mobile')} keyboardType="phone-pad" placeholder="05XXXXXXXX" /></View>
        <View style={{ flex: 1, minWidth: 160 }}><Input label="المهنة بالرخصة" value={f.profession} onChangeText={set('profession')} /></View>
        <View style={{ flex: 1, minWidth: 160 }}><Input label="القسم / النشاط الداخلي" value={f.internalSection} onChangeText={set('internalSection')} /></View>
      </View>
      <Text style={styles.label}>حالة الفحص</Text>
      <Chips value={f.examStatus} onChange={(v) => setF((s) => ({ ...s, examStatus: v }))}
        options={(Object.keys(EXAM) as ExamStatus[]).map((k) => ({ value: k, label: EXAM[k].label, color: EXAM[k].color }))} />
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        <View style={{ flex: 1, minWidth: 160 }}><Input label="تاريخ الفحص الطبي" value={f.examDate} onChangeText={set('examDate')} placeholder="YYYY-MM-DD" /></View>
        <View style={{ flex: 1, minWidth: 160 }}><Input label="تاريخ انتهاء الشهادة" value={f.certExpiry} onChangeText={set('certExpiry')} placeholder="YYYY-MM-DD" /></View>
      </View>
      <Input label="ملاحظات التنفيذ" value={f.notes} onChangeText={set('notes')} multiline />
      {error ? <Text style={{ color: colors.danger, marginBottom: 8, textAlign: textStart }}>{error}</Text> : null}
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        <View style={{ flex: 1, minWidth: 140 }}><Button title="حفظ" loading={busy === 'save'} onPress={() => void save()}
          disabled={f.workerName.trim().length < 3 || !f.branchName.trim() || !f.baladyLicenseNo.trim() || (!entry && !f.idNumber.trim())} /></View>
        <View style={{ flex: 1, minWidth: 140 }}><Button title="إلغاء" variant="outline" onPress={onCancel} /></View>
        {entry ? (
          <View style={{ flex: 1, minWidth: 140 }}>
            <Button title={confirmDelete ? 'تأكيد الحذف' : '🗑 حذف من السجل'} variant="danger" loading={busy === 'delete'} onPress={async () => {
              if (!confirmDelete) return setConfirmDelete(true);
              setBusy('delete');
              try { await api(`/health-register/${entry.id}`, { method: 'DELETE' }); onDone('حُذف العامل من السجل'); } catch (e) { setError(errorMessage(e)); }
              finally { setBusy(null); }
            }} />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

/** Wide screens: the Balady sheet as a real table (14 columns, sticky header, coloured status). */
function RegisterTable({ rows, onOpen }: { rows: Entry[]; onOpen: (e: Entry) => void }) {
  const total = COLUMNS.reduce((s, c) => s + c.width, 0);
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <ScrollView horizontal>
        <View style={{ width: total }}>
          <View style={{ flexDirection: 'row', backgroundColor: colors.primary }}>
            {COLUMNS.map((c) => (
              <Text key={c.title} style={{ width: c.width, padding: 8, color: '#fff', fontWeight: '800', fontSize: 12, textAlign: 'center',
                borderLeftWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}>{c.title}</Text>
            ))}
          </View>
          {rows.map((e, i) => (
            <Pressable key={e.id} onPress={() => onOpen(e)}
              style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
                flexDirection: 'row', backgroundColor: hovered || pressed ? colors.primaryLight : i % 2 ? '#FAFBFB' : '#fff',
                borderBottomWidth: 1, borderColor: '#EAECF0',
              })}>
              {COLUMNS.map((c, n) => {
                const isStatus = n === 12;
                const isExam = n === 10;
                const st = isStatus ? CERT[e.cert_status] : isExam ? EXAM[e.exam_status] : null;
                return (
                  <View key={c.title} style={{ width: c.width, padding: 8, justifyContent: 'center', borderLeftWidth: 1, borderColor: '#F2F4F7' }}>
                    {st ? (
                      <View style={{ alignItems: 'center' }}>
                        <Badge text={c.cell(e)} color={st.color} />
                        {isStatus && e.days_remaining !== null ? <Text style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>{daysText(e)}</Text> : null}
                      </View>
                    ) : (
                      <Text style={{ fontSize: 13, color: colors.text, textAlign: n === 0 ? 'center' : textStart, fontWeight: n === 4 ? '700' : '400' }}
                        numberOfLines={3}>{c.cell(e)}</Text>
                    )}
                  </View>
                );
              })}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Card>
  );
}

/** Health certificates register (Balady): the establishment's follow-up sheet, with computed certificate status. */
export default function HealthRegisterScreen() {
  const { can } = useAuth();
  const manage = can('staff:manage');
  const { width } = useWindowDimensions();
  const [status, setStatus] = useState<'ALL' | CertStatus>('ALL');
  const [branch, setBranch] = useState('ALL');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Entry | 'new' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { data, error, loading, offline, reload } = useApi<Entry[]>('/health-register');
  const all = data ?? [];

  const branches = useMemo(() => {
    const m = new Map<string, string>();
    all.forEach((e) => m.set(e.branch_name, e.balady_license_no));
    return [...m].map(([name, license]) => ({ name, license }));
  }, [all]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    all.forEach((e) => (c[e.cert_status] = (c[e.cert_status] ?? 0) + 1));
    return c;
  }, [all]);
  const q = search.trim().toLowerCase();
  const rows = all.filter((e) => (status === 'ALL' || e.cert_status === status) && (branch === 'ALL' || e.branch_name === branch)
    && (!q || [e.worker_name, e.profession, e.internal_section, e.mobile, e.id_number_masked.slice(-4), e.notes].some((x) => x?.toLowerCase().includes(q))));
  const wide = width >= 900;

  return (
    <ScrollView contentContainerStyle={[styles.page, wide && { maxWidth: 1600 }]} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      keyboardShouldPersistTaps="handled">
      <OfflineNote show={offline} />
      <Card>
        <Text style={styles.title}>سجل متابعة الشهادات الصحية والبيانات الوظيفية (منصة بلدي)</Text>
        <View style={[styles.row, { flexWrap: 'wrap', marginTop: 6 }]}>
          <Stat label="العاملون" value={all.length} />
          {(Object.keys(CERT) as CertStatus[]).map((k) => (
            <Pressable key={k} onPress={() => setStatus(status === k ? 'ALL' : k)}>
              <Stat label={CERT[k].label} value={counts[k] ?? 0} color={(counts[k] ?? 0) ? CERT[k].color : colors.muted} />
            </Pressable>
          ))}
        </View>
      </Card>

      <ExcelSync
        intro="صدّر السجل بنفس أعمدة ملف بلدي، أو استورد ملف المنشأة (Excel أو CSV) لإضافة العاملين وتحديثهم بحسب رقم الهوية — مع معاينة الأخطاء والملاحظات قبل التطبيق."
        exportPath="/health-register/export.xlsx" exportName={`سجل-الشهادات-الصحية-${new Date().toISOString().slice(0, 10)}.xlsx`}
        templateName="قالب-سجل-الشهادات-الصحية.xlsx" importPath="/health-register/import" accept=".xlsx,.csv,text/csv"
        canImport={manage} onImported={() => void reload()}
        describe={(c) => `${String(c.worker_name)} — ${String(c.cert_status)}`}
      />

      {message ? <Text style={{ color: colors.success, marginBottom: 8, textAlign: textStart }}>{message}</Text> : null}
      {manage && editing === 'new' ? (
        <EntryForm entry={null} branches={branches} onCancel={() => setEditing(null)}
          onDone={(m) => { setEditing(null); setMessage(m); void reload(); }} />
      ) : manage ? <Button title="➕ إضافة عامل" onPress={() => { setMessage(null); setEditing('new'); }} /> : null}
      {editing && editing !== 'new' ? (
        <EntryForm key={editing.id} entry={editing} branches={branches} onCancel={() => setEditing(null)}
          onDone={(m) => { setEditing(null); setMessage(m); void reload(); }} />
      ) : null}

      <View style={{ height: 10 }} />
      <Input placeholder="بحث بالاسم أو المهنة أو القسم أو الجوال أو آخر 4 أرقام من الهوية" value={search} onChangeText={setSearch} />
      <Chips value={status} onChange={setStatus} options={[{ value: 'ALL', label: 'كل الحالات' },
        ...(Object.keys(CERT) as CertStatus[]).map((k) => ({ value: k, label: CERT[k].label, color: CERT[k].color }))]} />
      {branches.length > 1 ? (
        <Chips value={branch} onChange={setBranch} options={[{ value: 'ALL', label: 'كل الفروع' }, ...branches.map((b) => ({ value: b.name, label: b.name }))]} />
      ) : null}
      {error ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text> : null}

      {!rows.length && !loading ? <Empty text="لا يوجد عاملون مطابقون" /> : wide ? (
        <RegisterTable rows={rows} onOpen={(e) => manage && (setMessage(null), setEditing(e))} />
      ) : rows.map((e) => (
        <Pressable key={e.id} onPress={() => manage && (setMessage(null), setEditing(e))}>
          <Card style={{ borderRightWidth: 5, borderRightColor: CERT[e.cert_status].color }}>
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Text style={[styles.body, { fontWeight: '800', flex: 1 }]}>{e.serial}. {e.worker_name}</Text>
              <Badge text={CERT[e.cert_status].label} color={CERT[e.cert_status].color} />
            </View>
            <Text style={styles.muted}>{e.profession ?? '—'} · {e.internal_section ?? '—'}</Text>
            <Text style={styles.muted}>{e.branch_name} · رخصة {e.balady_license_no}</Text>
            <Text style={styles.muted}>
              {e.id_type === 'CITIZEN' ? 'هوية' : 'إقامة'} {e.id_number_masked} · {e.mobile ?? '—'} · الميلاد {dmy(e.birth_date)}
            </Text>
            <Text style={styles.muted}>
              الفحص {dmy(e.exam_date)} — {EXAM[e.exam_status].label} · تنتهي {dmy(e.cert_expiry)} {e.days_remaining !== null ? `(${daysText(e)})` : ''}
            </Text>
            {e.notes ? <Text style={[styles.muted, { color: colors.text }]}>📝 {e.notes}</Text> : null}
          </Card>
        </Pressable>
      ))}
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}
