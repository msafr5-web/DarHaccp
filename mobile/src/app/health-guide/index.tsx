import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import type { GuideActivity, GuideRequirement, GuideStep, GuideTest, HealthGuide } from '@/api/types';
import { dmy, Pill, Section, SourceLine, VerificationBadge } from '@/components/GuideParts';
import { Badge, Button, Card, Chips, Empty, Loading, styles } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { colors } from '@/theme';

type Tab = 'requirements' | 'activities' | 'tests' | 'steps';

const TABS: { value: Tab; label: string }[] = [
  { value: 'requirements', label: 'ملخص المتطلبات' },
  { value: 'activities', label: 'الأنشطة المستهدفة' },
  { value: 'tests', label: 'الفحوصات الطبية' },
  { value: 'steps', label: 'خطوات الإصدار' },
];

const REQ_GROUPS: { title: string; kinds: GuideRequirement['kind'][] }[] = [
  { title: 'شروط الإصدار', kinds: ['REQUIREMENT'] },
  { title: 'شروط مشروطة بالمدينة', kinds: ['CONDITION'] },
  { title: 'الرسوم والصلاحية والتجديد', kinds: ['FEE', 'VALIDITY'] },
  { title: 'قناة التقديم ومقدم الطلب', kinds: ['CHANNEL'] },
  { title: 'ملاحظات إجرائية', kinds: ['NOTE'] },
  { title: 'الجزاءات', kinds: ['PENALTY'] },
  { title: 'الدعم', kinds: ['SUPPORT'] },
];

const ACTOR = { APPLICANT: 'مقدم الطلب', HEALTH_CENTER: 'المركز الصحي', TRAINING_CENTER: 'جهة التثقيف', SYSTEM: 'النظام' } as const;
const SYSTEM = { BALADY: 'بلدي', SEHHA: 'صحة', TRAINING: 'التثقيف الصحي', PAYMENT: 'السداد' } as const;
const CATEGORY = { CLINICAL: '🩺 سريري', LAB: '🧪 مختبر', IMAGING: '🩻 أشعة' } as const;
const TRACKED: Record<string, string> = {
  request_no: 'رقم الطلب', exam_status: 'حالة الفحص', edu_status: 'حالة التثقيف', fee_paid_on: 'تاريخ السداد', cert_expiry: 'تاريخ انتهاء الشهادة',
};

function Requirement({ r, g }: { r: GuideRequirement; g: HealthGuide }) {
  return (
    <Card>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Text style={[styles.body, { fontWeight: '800', flex: 1 }]}>{r.title_ar}</Text>
        {r.value_text ? <Text style={{ fontSize: 17, fontWeight: '900', color: colors.primary }}>{r.value_text}</Text> : null}
      </View>
      <Text style={[styles.body, { marginTop: 4 }]}>{r.detail_ar}</Text>
      {r.items.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
          {r.items.map((c) => <Pill key={c} text={c} color={colors.primary} />)}
        </View>
      ) : null}
      <View style={[styles.row, { marginTop: 6, flexWrap: 'wrap' }]}>
        <VerificationBadge v={r.verification} />
        <Text style={styles.muted}>تحقق: {dmy(r.verified_on)}</Text>
      </View>
      <SourceLine code={r.source_code} sources={g.sources} />
    </Card>
  );
}

function Activity({ a, g }: { a: GuideActivity; g: HealthGuide }) {
  return (
    <Card style={{ borderRightWidth: 5, borderRightColor: a.sector === 'FOOD' ? colors.success : colors.primary }}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Text style={[styles.body, { fontWeight: '800', flex: 1 }]}>{a.name_ar}</Text>
        <Badge text={a.cert_required ? 'الشهادة مطلوبة' : 'غير مطلوبة'} color={a.cert_required ? colors.success : colors.muted} />
      </View>
      {a.examples_ar ? <Text style={styles.muted}>{a.examples_ar}</Text> : null}
      {a.notes_ar ? <Text style={[styles.body, { color: colors.warning, marginTop: 4 }]}>⚠ {a.notes_ar}</Text> : null}
      <View style={[styles.row, { marginTop: 6, flexWrap: 'wrap' }]}>
        <VerificationBadge v={a.verification} />
      </View>
      <SourceLine code={a.source_code} sources={g.sources} />
    </Card>
  );
}

function TestCard({ t, g }: { t: GuideTest; g: HealthGuide }) {
  return (
    <Card>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Text style={[styles.body, { fontWeight: '800', flex: 1 }]}>{t.name_ar}</Text>
        <Badge text={t.applicability === 'COMMON' ? 'يُجرى عادةً' : 'حسب الحالة'} color={t.applicability === 'COMMON' ? colors.primary : colors.warning} />
      </View>
      <Text style={[styles.muted, { marginBottom: 2 }]}>{CATEGORY[t.category]}</Text>
      <Text style={styles.body}>{t.purpose_ar}</Text>
      <View style={[styles.row, { marginTop: 6 }]}><VerificationBadge v={t.verification} /></View>
      <SourceLine code={t.source_code} sources={g.sources} />
    </Card>
  );
}

function Step({ s, g, last }: { s: GuideStep; g: HealthGuide; last: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <View style={{ alignItems: 'center' }}>
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: s.tracked_by ? colors.primary : colors.muted, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '900' }}>{s.step_no}</Text>
        </View>
        {!last ? <View style={{ flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 }} /> : null}
      </View>
      <Card style={{ flex: 1, marginBottom: 10 }}>
        <Text style={[styles.body, { fontWeight: '800' }]}>{s.title_ar}</Text>
        <Text style={[styles.body, { marginTop: 4 }]}>{s.detail_ar}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
          <Pill text={`👤 ${ACTOR[s.actor]}`} />
          <Pill text={`🖥 ${SYSTEM[s.system_name]}`} />
          {s.conditional ? <Pill text="حيث يُفعَّل البرنامج" color={colors.warning} /> : null}
          {s.tracked_by ? <Pill text={`📌 يُتابَع في سجل المنشأة: ${TRACKED[s.tracked_by]}`} color={colors.primary} /> : null}
        </View>
        <SourceLine code={s.source_code} sources={g.sources} />
      </Card>
    </View>
  );
}

/** The health certificate guide: the four tabs of the establishment's workbook, with the source of every item. */
export default function HealthGuideScreen() {
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const [tab, setTab] = useState<Tab>(params.tab ?? 'requirements');
  const { data: g, error, loading, reload } = useApi<HealthGuide>('/health-guide');

  if (error) return <Empty text={error} />;
  if (!g) return <Loading />;

  const unofficial = g.tests.some((t) => t.verification !== 'OFFICIAL');
  return (
    <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}>
      <Card style={{ backgroundColor: colors.primaryLight }}>
        <Text style={styles.title}>دليل الشهادة الصحية — منصة بلدي</Text>
        <Text style={[styles.body, { marginTop: 4 }]}>
          مرجع مجمَّع من صفحات وزارة البلديات والإسكان ومنصة بلدي (آخر تحقق: {dmy(g.lastVerified)}). الأنظمة والرسوم تتغير، والمعتمد دائماً ما تعرضه منصة بلدي عند التقديم.
        </Text>
        <Button title="🪪 العودة إلى سجل الشهادات الصحية" variant="outline" onPress={() => router.push('/health-register')} />
      </Card>

      <Chips value={tab} onChange={setTab} options={TABS} />

      {tab === 'requirements' ? (
        REQ_GROUPS.map((grp) => {
          const items = g.requirements.filter((r) => grp.kinds.includes(r.kind));
          if (!items.length) return null;
          return (
            <View key={grp.title}>
              <Section title={grp.title} />
              {items.map((r) => <Requirement key={r.id} r={r} g={g} />)}
            </View>
          );
        })
      ) : null}

      {tab === 'activities' ? (
        <>
          <Card><Text style={styles.body}>تُلزم الشهادة الصحية العاملين في المنشآت الغذائية وفي الأنشطة المرتبطة بالصحة العامة. يقترح سجل المنشأة نشاط كل عامل من مهنته وقسمه، ويمكن تثبيته يدوياً.</Text></Card>
          <Section title="منشآت الغذاء" />
          {g.activities.filter((a) => a.sector === 'FOOD').map((a) => <Activity key={a.id} a={a} g={g} />)}
          <Section title="أنشطة الصحة العامة" />
          {g.activities.filter((a) => a.sector === 'PUBLIC_HEALTH').map((a) => <Activity key={a.id} a={a} g={g} />)}
        </>
      ) : null}

      {tab === 'tests' ? (
        <>
          <Card style={{ backgroundColor: colors.warningLight, borderColor: colors.warning }}>
            <Text style={[styles.body, { fontWeight: '800', color: colors.warning }]}>⚠ انتبه: لا توجد قائمة رسمية منشورة بالفحوصات</Text>
            <Text style={[styles.body, { marginTop: 4 }]}>
              الشرط الرسمي في بلدي هو «تقرير طبي لائق من مركز صحي معتمد من وزارة الصحة». أما الفحوصات التالية فهي ما تعلنه المراكز الطبية في الرياض ضمن فحص البلدية،
              وتختلف تفاصيلها من مركز إلى آخر؛ فاعتمد ما يقرره المركز المعتمد. {unofficial ? 'ولذلك تحمل كل بطاقة وسم «غير رسمي».' : ''}
            </Text>
          </Card>
          {g.tests.map((t) => <TestCard key={t.id} t={t} g={g} />)}
          <Card style={{ backgroundColor: '#F8FBF9' }}>
            <Text style={[styles.body, { fontWeight: '800' }]}>🔒 خصوصية العاملين</Text>
            <Text style={styles.body}>
              لا يحفظ هذا النظام نتائج التحاليل الطبية إطلاقاً، وإنما نتيجة الفحص الرسمية فقط (سليم / بانتظار النتيجة / غير لائق) كما تظهر في بلدي.
            </Text>
          </Card>
        </>
      ) : null}

      {tab === 'steps' ? (
        <>
          <Card>
            <Text style={styles.body}>
              ترتيب التقديم على بلدي كما في دليل المستخدم الرسمي. الخطوات التي تحمل علامة 📌 تُتابَع لكل عامل في سجل المنشأة، فيُعرض «الخطوة التالية» لكل عامل.
            </Text>
          </Card>
          {g.steps.map((s, i) => <Step key={s.id} s={s} g={g} last={i === g.steps.length - 1} />)}
          <Section title="المدن التي فُعِّل فيها التثقيف الصحي" />
          <Card>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {g.eduCities.map((c) => <Pill key={c} text={c} color={colors.primary} />)}
            </View>
            <Text style={styles.muted}>في غيرها لا تُطلب خطوة التثقيف، ويمكن إصدار الشهادة بعد الكشف الطبي.</Text>
          </Card>
        </>
      ) : null}

      <Section title="المصادر" />
      {g.sources.map((s) => (
        <Card key={s.code} style={{ paddingVertical: 10 }}>
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <Text style={[styles.body, { fontWeight: '700', flex: 1 }]}>{s.title}</Text>
            <Badge text={s.level === 'OFFICIAL' ? 'رسمي' : 'مراكز طبية'} color={s.level === 'OFFICIAL' ? colors.success : colors.warning} />
          </View>
          <Text style={styles.muted}>{s.publisher} · اطُّلع عليه {dmy(s.retrieved_on)}</Text>
          <SourceLine code={s.code} sources={g.sources} />
        </Card>
      ))}
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}
