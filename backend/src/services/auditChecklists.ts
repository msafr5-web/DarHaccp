/**
 * Internal audit checklists (PRD §2.1-5). Clauses reference HACCP / ISO 22000 prerequisite
 * programmes, ISO 45001 and Saudi regulators (SFDA, Riyadh municipality, Civil Defense).
 */
export interface ChecklistItem {
  id: string;
  clause: string;
  question: string;
}

export const CHECKLISTS = {
  HACCP_ISO22000: {
    titleAr: 'تدقيق سلامة الغذاء (HACCP / ISO 22000)',
    items: [
      { id: 'FS-01', clause: 'ISO 22000 §8.5.4', question: 'جميع نقاط التحكم الحرجة مراقبة ومسجلة حسب التكرار المحدد في خطة الهاسب' },
      { id: 'FS-02', clause: 'ISO 22000 §8.5.4.4', question: 'تم اتخاذ وتوثيق الإجراءات التصحيحية لكل انحراف خلال آخر 30 يوماً' },
      { id: 'FS-03', clause: 'PRP — Temperature control', question: 'درجات حرارة الثلاجات ≤ 4°م والفريزرات ≤ -18°م مطابقة عند الفحص الفعلي' },
      { id: 'FS-04', clause: 'PRP — Cross contamination', question: 'فصل الأغذية النيئة عن المطبوخة وألواح التقطيع الملونة مطبقة' },
      { id: 'FS-05', clause: 'SFDA — Labelling', question: 'جميع المنتجات المحضرة تحمل بطاقة بيانات (تاريخ الإنتاج والانتهاء والمكونات)' },
      { id: 'FS-06', clause: 'PRP — Personal hygiene', question: 'العاملون يحملون شهادات صحية سارية ويلتزمون بالزي والنظافة الشخصية' },
      { id: 'FS-07', clause: 'PRP — Cleaning & sanitation', question: 'برنامج التنظيف والتعقيم مطبق وتراكيز المطهرات موثقة' },
      { id: 'FS-08', clause: 'PRP — Pest control', question: 'زيارات مكافحة الآفات موثقة ولا يوجد نشاط للآفات' },
      { id: 'FS-09', clause: 'ISO 22000 §8.9', question: 'المرتجعات من المناسبات تُتلف ولا يعاد إدخالها مع توثيق الإتلاف' },
      { id: 'FS-10', clause: 'ISO 22000 §8.7', question: 'أجهزة القياس (المجسات الحرارية) معايرة وتاريخ المعايرة ساري' },
    ],
  },
  ISO45001_HSE: {
    titleAr: 'تدقيق الصحة والسلامة المهنية (ISO 45001 / الدفاع المدني)',
    items: [
      { id: 'HS-01', clause: 'Civil Defense', question: 'طفايات الحريق متوفرة حسب المخطط، مضغوطة، وتاريخ الفحص ساري' },
      { id: 'HS-02', clause: 'Civil Defense', question: 'مخارج الطوارئ ومسارات الإخلاء واضحة وغير معاقة' },
      { id: 'HS-03', clause: 'ISO 45001 §8.2', question: 'خطة الإخلاء محدثة ومعلقة وتم تنفيذ تمرين إخلاء خلال آخر 6 أشهر' },
      { id: 'HS-04', clause: 'ISO 45001 §8.1.2', question: 'معدات الوقاية الشخصية متوفرة ومستخدمة (قفازات حرارية، أحذية سلامة)' },
      { id: 'HS-05', clause: 'ISO 45001 §6.1.2', question: 'تقييم المخاطر محدث لجميع الأنشطة (الغاز، الزيوت الساخنة، الأدوات الحادة)' },
      { id: 'HS-06', clause: 'ISO 45001 §10.2', question: 'الحوادث وشبه الحوادث مسجلة ومحقق فيها' },
      { id: 'HS-07', clause: 'Saudi Labor Law', question: 'حقيبة الإسعافات الأولية مكتملة ومسعف مدرب متواجد في كل وردية' },
      { id: 'HS-08', clause: 'ISO 45001 §8.1.4', question: 'المقاولون مقيّمون ومعتمدون ولديهم تصاريح عمل سارية' },
    ],
  },
} as const satisfies Record<string, { titleAr: string; items: readonly ChecklistItem[] }>;

export type AuditStandard = keyof typeof CHECKLISTS;
export const AUDIT_STANDARDS = Object.keys(CHECKLISTS) as [AuditStandard, ...AuditStandard[]];
