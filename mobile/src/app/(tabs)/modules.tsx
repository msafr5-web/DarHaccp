import { Href, router } from 'expo-router';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { styles } from '@/components/ui';
import { useAuth, UiPermission } from '@/context/AuthContext';
import { colors, textStart } from '@/theme';

interface ModuleLink {
  icon: string;
  title: string;
  description: string;
  href: Href;
  permission: UiPermission;
}

/** PRD §2.1: the five operational modules, filtered by what the signed-in role may use. */
const SECTIONS: { title: string; links: ModuleLink[] }[] = [
  {
    title: 'النماذج والسجلات',
    links: [
      { icon: '📟', title: 'الأجهزة ومسجلات البيانات', description: 'الثلاجات والحساسات: رمز QR لكل جهاز، الصيانة والمعايرة، طباعة الملصقات', href: '/equipment', permission: 'equipment:read' },
      { icon: '📄', title: 'سجلات النماذج المعبأة', description: 'من عبأ، أين، بأي جهاز ومتى — مع سجل التعديلات', href: '/records', permission: 'record:read' },
    ],
  },
  {
    title: 'الجودة والتحسين المستمر',
    links: [
      { icon: '🚨', title: 'الإبلاغ عن حادث / عدم مطابقة', description: 'بلاغ فوري يفتح إجراءً تصحيحياً تلقائياً', href: '/incidents/new', permission: 'incident:create' },
      { icon: '📂', title: 'سجل الحوادث وعدم المطابقة', description: 'متابعة التحقيق والإغلاق عبر CAPA', href: '/incidents', permission: 'incident:read' },
      { icon: '🔍', title: 'التدقيق الداخلي', description: 'HACCP / ISO 22000 و ISO 45001 مع تحويل الملاحظات لإجراءات', href: '/audits', permission: 'internal-audit:read' },
    ],
  },
  {
    title: 'مطبخ الحلويات والإنتاج',
    links: [
      { icon: '🏷️', title: 'بطاقات البيانات', description: 'تاريخ الإنتاج والانتهاء والمكونات — طباعة مع QR', href: '/labels', permission: 'label:read' },
      { icon: '➕', title: 'إصدار بطاقة بيانات', description: 'من الوصفة المعتمدة مع حساب الصلاحية تلقائياً', href: '/labels/new', permission: 'label:create' },
    ],
  },
  {
    title: 'الخدمات المساندة والسلامة (HSE)',
    links: [
      { icon: '👷', title: 'سجل العاملين والشهادات الصحية', description: 'الصلاحية للعمل، شهادة البلدية، الفحص اليومي', href: '/staff', permission: 'staff:read' },
      { icon: '🤝', title: 'المقاولون ومكافحة الآفات', description: 'التراخيص والعقود وتقييم الأداء', href: '/contractors', permission: 'contractor:read' },
      { icon: '📑', title: 'الوثائق المعتمدة', description: 'سياسات IMS، خطط الإخلاء، مخططات الطفايات', href: '/documents', permission: 'document:read' },
    ],
  },
  {
    title: 'حساب الشركة والأمان',
    links: [
      { icon: '👥', title: 'الموظفون والصلاحيات', description: 'إضافة الموظفين: تعبئة فقط أو تعبئة وتعديل', href: '/users', permission: 'user:manage' },
      { icon: '🔐', title: 'سجل محاولات الدخول', description: 'كل محاولة دخول ناجحة أو فاشلة على حسابات الشركة', href: '/security', permission: 'security:read' },
    ],
  },
];

export default function ModulesScreen() {
  const { can } = useAuth();
  const { width } = useWindowDimensions();
  const columns = width >= 900 ? 3 : width >= 560 ? 2 : 1;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {SECTIONS.map((section) => {
        const links = section.links.filter((l) => can(l.permission));
        if (!links.length) return null;
        return (
          <View key={section.title} style={{ marginBottom: 18 }}>
            <Text style={[styles.title, { marginBottom: 10 }]}>{section.title}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {links.map((l) => (
                <Pressable
                  key={l.title}
                  onPress={() => router.push(l.href)}
                  style={({ pressed }) => [{
                    width: columns === 1 ? '100%' : `${100 / columns - 2}%`, backgroundColor: colors.card, borderRadius: 16, padding: 16,
                    borderWidth: 1, borderColor: '#EAECF0', opacity: pressed ? 0.85 : 1,
                  }]}
                >
                  <Text style={{ fontSize: 28, textAlign: textStart }}>{l.icon}</Text>
                  <Text style={[styles.title, { fontSize: 16, marginTop: 6 }]}>{l.title}</Text>
                  <Text style={[styles.muted, { marginTop: 4 }]}>{l.description}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}
