/**
 * Health certificate knowledge base — the four tabs of the establishment's workbook:
 *   ملخص المتطلبات · الأنشطة المستهدفة · الفحوصات الطبية · خطوات الإصدار
 *
 * Every item names the page it comes from. Levels:
 *   OFFICIAL  — stated on a Ministry of Municipal, Rural Affairs and Housing / Balady page (read on RETRIEVED);
 *   REPORTED  — published by medical centres as their practice; NOT a regulation;
 *   UNVERIFIED — a reasonable reading that no official page states (clearly flagged to the user).
 * Nothing here is invented: where an official page gives no value (e.g. fine amounts, the medical test list)
 * the guide says so instead of filling the gap.
 *
 * `REVISION` is bumped when this text changes: rows the platform administrator has not edited are upgraded on
 * the next deployment; edited rows are never overwritten.
 */
export const REVISION = 1;
export const RETRIEVED = '2026-10-23';

export const sources = [
  {
    code: 'BALADY_SERVICE', level: 'OFFICIAL', publisher: 'وزارة البلديات والإسكان — منصة بلدي',
    title: 'خدمة إصدار شهادة صحية (وصف الخدمة، المتطلبات، الاشتراطات، الرسوم)',
    url: 'https://balady.gov.sa/ar/services/%D8%A5%D8%B5%D8%AF%D8%A7%D8%B1-%D8%B4%D9%87%D8%A7%D8%AF%D8%A9-%D8%B5%D8%AD%D9%8A%D8%A9',
  },
  {
    code: 'BALADY_FAQ', level: 'OFFICIAL', publisher: 'وزارة البلديات والإسكان — منصة بلدي',
    title: 'الأسئلة الشائعة: الشهادات الصحية والتثقيف الصحي والفحص الطبي',
    url: 'https://balady.gov.sa/ar/help-and-support/faq-list?page=47',
  },
  {
    code: 'BALADY_GUIDE', level: 'OFFICIAL', publisher: 'وزارة البلديات والإسكان',
    title: 'دليل المستخدم لخدمة إصدار شهادة صحية — المستفيد (41 صفحة، أبريل 2026)',
    url: 'https://momah.gov.sa/sites/default/files/2026-04/dlyl%20almstkhdm%20lkhdmt%20asdar%20shhadt%20shyt%20-%20almstfyd.pdf',
  },
  {
    code: 'MOMAH_NEWS', level: 'OFFICIAL', publisher: 'وزارة البلديات والإسكان',
    title: 'وزارة البلديات والإسكان تؤكد أهمية الشهادات الصحية للعاملين في أنشطة الغذاء والصحة العامة',
    url: 'https://momah.gov.sa/ar/node/16771',
  },
  {
    code: 'CLINICS_RIYADH', level: 'CLINICS', publisher: 'مراكز طبية خاصة في الرياض (رهى الصحية، مجمع الطائف الطبي)',
    title: 'الفحص الطبي الخاص بالبلدية (الشهادات الصحية) بالرياض',
    url: 'https://taifclinic.sa/municipality-health-certificate-riyadh/',
  },
] as const;

type Verification = 'OFFICIAL' | 'REPORTED' | 'UNVERIFIED';
const CITIES = [
  'مكة المكرمة (أمانة العاصمة المقدسة)', 'المدينة المنورة', 'المنطقة الشرقية', 'الطائف', 'جدة', 'الأحساء', 'القصيم',
  'جازان', 'حائل', 'عسير', 'تبوك', 'حفر الباطن',
];
export const EDU_CITIES = CITIES;

export interface RequirementSeed {
  code: string; kind: 'REQUIREMENT' | 'CONDITION' | 'FEE' | 'VALIDITY' | 'PENALTY' | 'CHANNEL' | 'SUPPORT' | 'NOTE';
  title: string; detail: string; value?: string; items?: string[]; source: string; sort: number; verification?: Verification;
}

export const requirements: RequirementSeed[] = [
  { code: 'REQ_SERVICES', kind: 'CHANNEL', sort: 10, source: 'BALADY_FAQ', title: 'الخدمات المتاحة',
    detail: 'ثلاث خدمات على بلدي: إصدار شهادة صحية، وتجديد شهادة صحية، وإلغاء شهادة صحية.' },
  { code: 'REQ_CHANNEL', kind: 'CHANNEL', sort: 20, source: 'BALADY_SERVICE', title: 'قناة التقديم', value: 'إلكترونياً فقط',
    detail: 'التقديم عبر بوابة بلدي أو تطبيق الجوال دون مراجعة الجهة. لغة الخدمة: العربية.' },
  { code: 'REQ_APPLICANT', kind: 'CHANNEL', sort: 30, source: 'BALADY_GUIDE', title: 'صفة مقدم الطلب',
    detail: 'يقدّم الطلب العامل عن نفسه، أو مالك/مدير المنشأة، أو مفوَّض. للمالك والمفوض يُدخل الرقم الموحد للمنشأة ويُعرض سجلها التجاري (الرقم الوطني، المدينة، تاريخا الإصدار والانتهاء).' },
  { code: 'REQ_MEDICAL', kind: 'REQUIREMENT', sort: 40, source: 'BALADY_FAQ', title: 'تقرير طبي «لائق»', value: 'لائق',
    detail: 'كشف طبي لائق من مركز صحي معتمد من وزارة الصحة. يحدّث المركز النتيجة على منصة «صحة»، وبالربط بين المنصتين تتحدث حالة الفحص في بلدي آلياً إلى «لائق» أو «غير لائق».' },
  { code: 'REQ_VERIFY', kind: 'REQUIREMENT', sort: 50, source: 'BALADY_SERVICE', title: 'التحققات المطلوبة',
    detail: 'التحقق من المهنة، ورخصة المحل، ونشاط الرخصة، وتختلف الإجراءات حسب كل أمانة للعامل غير السعودي. يُستثنى من طلب رخصة المحل: المطارات والجهات الحكومية (المدنية والأمنية والعسكرية). وإن لم تُسترجع مهنة المقيم أو صاحب رقم الحدود من وزارة الداخلية تُدخل يدوياً.' },
  { code: 'REQ_DECLARATION', kind: 'REQUIREMENT', sort: 60, source: 'BALADY_GUIDE', title: 'الإقرار والتعهد',
    detail: 'الموافقة على إقرار بأن العاملين السعوديين يعملون لدى المنشأة، وأن غير السعوديين على كفالتها، قبل إرسال الطلب.' },
  { code: 'REQ_EDU', kind: 'CONDITION', sort: 70, source: 'BALADY_FAQ', title: 'التثقيف الصحي (حيث يُفعَّل)', value: 'اختبار',
    items: CITIES,
    detail: 'إجباري في الأمانات التي فعّلته فقط، وفق قائمة المهن المعتمدة: اجتياز دورة التثقيف الصحي ثم الاختبار. المدن المشمولة بحسب صفحة الخدمة في بلدي مذكورة في القائمة. تقدّم البرنامج جهات تدريبية مرخّصة من المؤسسة العامة للتدريب التقني والمهني، ويشرف على الاختبار وزارة البلديات والإسكان والأمانات.' },
  { code: 'REQ_EDU_RETAKE', kind: 'CONDITION', sort: 80, source: 'BALADY_FAQ', title: 'الرسوب في اختبار التثقيف الصحي', value: '150 ريال',
    detail: 'المرة الأولى: إعادة الاختبار مجاناً. المرة الثانية: يدفع المستفيد 150 ريالاً قيمة الاختبار. المرة الثالثة: يعيد التسجيل في برنامج التثقيف الصحي ويتثقف ويُختبر من جديد.' },
  { code: 'FEE', kind: 'FEE', sort: 90, source: 'BALADY_SERVICE', title: 'رسوم الشهادة الصحية', value: '60 ريالاً',
    detail: 'تُسدَّد عبر سداد أو فيزا أو ماستر كارد أو مدى أو أبل باي. تقديم الطلب نفسه لا يُدفع عنه، والفاتورة تُسدَّد لاحقاً.' },
  { code: 'VALIDITY', kind: 'VALIDITY', sort: 100, source: 'MOMAH_NEWS', title: 'مدة الصلاحية', value: 'سنة واحدة',
    detail: 'تبلغ مدة صلاحية الشهادة الصحية سنة واحدة من تاريخ إصدارها.' },
  { code: 'RENEWAL', kind: 'VALIDITY', sort: 110, source: 'MOMAH_NEWS', title: 'التجديد', value: 'قبل 60 يوماً',
    detail: 'يمكن تجديد الشهادة قبل انتهاء صلاحيتها بـ 60 يوماً. يعرض سجل المنشأة في هذا النظام علامة «التجديد متاح» لكل عامل دخل هذه النافذة.' },
  { code: 'ISSUE_TIME', kind: 'NOTE', sort: 120, source: 'BALADY_SERVICE', title: 'مدة الإصدار', value: 'فوري',
    detail: 'تُصدر الشهادة تلقائياً بعد الانتهاء من الكشف الطبي، ما لم يكن التثقيف الصحي مفعّلاً في المدينة. وفي المدن غير المفعّل فيها التثقيف يمكن إصدار الشهادة استباقياً بعد الحصول على الكشف الطبي.' },
  { code: 'AMANA_REDIRECT', kind: 'NOTE', sort: 130, source: 'BALADY_GUIDE', title: 'أمانتا الرياض والمنطقة الشرقية',
    detail: 'عند اختيار أمانة منطقة الرياض أو أمانة المنطقة الشرقية تظهر رسالة تنقل المستخدم إلى موقع الأمانة نفسها لإصدار الشهادة الصحية، ثم تُعبّأ الأمانة والبلدية والمدينة والحي تلقائياً.' },
  { code: 'PRINTING', kind: 'NOTE', sort: 140, source: 'BALADY_GUIDE', title: 'الطباعة',
    detail: 'بعد أن تصبح حالة الطلب «منتهي» تُطبع كل شهادة على حدة أو جميع شهادات الطلب في ملف واحد. وفي حال التثقيف المفعّل لا تُصدر الشهادة قبل اجتيازه.' },
  { code: 'PENALTIES', kind: 'PENALTY', sort: 150, source: 'BALADY_SERVICE', title: 'المخالفات والجزاءات',
    detail: 'تُحال المخالفات إلى لائحة الجزاءات عن المخالفات البلدية، وإلى جدول تصنيف المخالفات وعقوباتها وفق نظام الغذاء ولائحته التنفيذية. لم تذكر صفحة الخدمة قيم الغرامات، ولذلك لا يعرض هذا الدليل مبالغ.' },
  { code: 'SUPPORT', kind: 'SUPPORT', sort: 160, source: 'BALADY_SERVICE', title: 'الدعم', value: '199040',
    detail: 'خدمة العملاء 199040 (من 8 صباحاً حتى 10 مساءً طوال الأسبوع) · infocs@momah.gov.sa · الخدمات الذاتية متاحة على مدار الساعة ووقت الاستجابة 24 ساعة.' },
];

export interface ActivitySeed {
  code: string; sector: 'FOOD' | 'PUBLIC_HEALTH'; name: string; examples?: string; keywords: string[]; notes?: string;
  source: string; sort: number; verification?: Verification;
}

export const activities: ActivitySeed[] = [
  { code: 'RESTAURANT', sector: 'FOOD', sort: 10, source: 'MOMAH_NEWS', name: 'المطاعم', examples: 'مطاعم الخدمة السريعة والعائلية والمطاعم الشعبية',
    keywords: ['مطعم'] },
  { code: 'CAFE', sector: 'FOOD', sort: 20, source: 'MOMAH_NEWS', name: 'المقاهي', examples: 'المقاهي ومحال المشروبات', keywords: ['مقهى', 'مقاهي', 'قهوة', 'باريستا'] },
  { code: 'BAKERY', sector: 'FOOD', sort: 30, source: 'MOMAH_NEWS', name: 'المخابز', examples: 'المخابز ومحال المعجنات والحلويات',
    keywords: ['مخبز', 'خباز', 'معجنات', 'حلويات', 'حلواني'] },
  { code: 'FOOD_RETAIL', sector: 'FOOD', sort: 40, source: 'MOMAH_NEWS', name: 'محال بيع الأغذية', examples: 'محال بيع الأغذية بالتجزئة',
    keywords: ['بقالة', 'تموينات', 'سوبر', 'بائع أغذية', 'محل أغذية', 'جزار', 'لحوم'] },
  { code: 'KITCHEN', sector: 'FOOD', sort: 50, source: 'MOMAH_NEWS', verification: 'UNVERIFIED', name: 'المطابخ المركزية وتحضير الأغذية والتقديم',
    examples: 'المطابخ المركزية، تجهيز الأغذية، تقديم الطعام',
    keywords: ['مطبخ', 'طباخ', 'طاهي', 'شيف', 'تحضير', 'مباشر طعام', 'تقديم', 'ضيافة', 'مساعد طباخ', 'عامل غذاء'],
    notes: 'لم تسمِّ صفحة الوزارة هذا النشاط صراحة، لكنه يندرج ضمن «المنشآت الغذائية». تأكد من نشاط رخصة منشأتك في بلدي قبل الاعتماد.' },
  { code: 'MEN_SALON', sector: 'PUBLIC_HEALTH', sort: 60, source: 'MOMAH_NEWS', name: 'صالونات الحلاقة الرجالية', examples: 'الحلاقة الرجالية',
    keywords: ['حلاق', 'حلاقة', 'صالون رجالي'] },
  { code: 'WOMEN_SALON', sector: 'PUBLIC_HEALTH', sort: 70, source: 'MOMAH_NEWS', name: 'صالونات التزيين النسائية', examples: 'التزيين والعناية النسائية',
    keywords: ['تزيين', 'صالون نسائي', 'مزينة', 'كوافير', 'عناية نسائية'] },
  { code: 'LAUNDRY', sector: 'PUBLIC_HEALTH', sort: 80, source: 'MOMAH_NEWS', name: 'مغاسل الملابس', examples: 'مغاسل الملابس والكي', keywords: ['مغسلة', 'مغاسل', 'كوي', 'غسيل'] },
  { code: 'RELAX_CENTER', sector: 'PUBLIC_HEALTH', sort: 90, source: 'MOMAH_NEWS', name: 'مراكز الاسترخاء والعناية بالجسم', examples: 'مراكز الاسترخاء والمساج والعناية بالجسم',
    keywords: ['استرخاء', 'مساج', 'عناية بالجسم', 'سبا', 'مدلك'] },
];

export interface TestSeed {
  code: string; category: 'CLINICAL' | 'LAB' | 'IMAGING'; name: string; purpose: string; applicability?: 'COMMON' | 'CASE_BY_CASE'; sort: number;
}

/**
 * The Ministry of Municipal, Rural Affairs and Housing / Balady pages reviewed do NOT list the individual tests: they
 * require "a fit medical report from a Ministry of Health approved centre" (REQ_MEDICAL). The tests below are what
 * medical centres in Riyadh publish as their municipality health-certificate examination — reported practice, to be
 * confirmed with the centre. The system stores no test results (only the official fit / unfit outcome).
 */
export const medicalTests: TestSeed[] = [
  { code: 'CLINICAL_EXAM', category: 'CLINICAL', sort: 10, name: 'الكشف السريري العام', applicability: 'COMMON',
    purpose: 'قياس الضغط والنبض والحرارة، ومراجعة التاريخ الصحي، وفحص القلب والرئتين والجهاز الهضمي، وفحص الجلد بحثاً عن الأمراض الجلدية المعدية (كالجرب والفطريات).' },
  { code: 'STOOL_TEST', category: 'LAB', sort: 20, name: 'تحليل البراز', applicability: 'COMMON',
    purpose: 'الكشف عن الطفيليات المعوية، وعن بكتيريا السالمونيلا والشيغيلا لدى حاملي العدوى. وهو التحليل المنتظَر في سجل المنشأة (ملاحظة «بانتظار ظهور تحاليل البراز»).' },
  { code: 'BLOOD_TEST', category: 'LAB', sort: 30, name: 'تحاليل الدم للأمراض المعدية', applicability: 'COMMON',
    purpose: 'تذكر المراكز أنها تشمل التهاب الكبد الوبائي والتيفوئيد وأمراضاً معدية أخرى. تختلف القائمة التفصيلية من مركز إلى آخر، فاعتمد ما يقرره المركز المعتمد.' },
  { code: 'URINE_TEST', category: 'LAB', sort: 40, name: 'تحليل البول', applicability: 'COMMON',
    purpose: 'الكشف عن الالتهابات والعدوى البكتيرية.' },
  { code: 'CHEST_XRAY', category: 'IMAGING', sort: 50, name: 'أشعة الصدر', applicability: 'CASE_BY_CASE',
    purpose: 'التأكد من خلو الجهاز التنفسي من الأمراض المعدية وخاصة السل. تذكر بعض المراكز أنها تُطلب حسب الحالة وليس لكل عامل.' },
  { code: 'THROAT_SWAB', category: 'LAB', sort: 60, name: 'مسحة الأنف والحلق', applicability: 'CASE_BY_CASE',
    purpose: 'الكشف عن الدفتيريا وحاملي الجراثيم؛ تُجرى حسب تقدير الطبيب.' },
];

export interface StepSeed {
  code: string; no: number; title: string; detail: string; actor: 'APPLICANT' | 'HEALTH_CENTER' | 'TRAINING_CENTER' | 'SYSTEM';
  system: 'BALADY' | 'SEHHA' | 'TRAINING' | 'PAYMENT'; trackedBy?: 'request_no' | 'exam_status' | 'edu_status' | 'fee_paid_on' | 'cert_expiry';
  conditional?: boolean; source: string;
}

export const steps: StepSeed[] = [
  { code: 'LOGIN', no: 1, actor: 'APPLICANT', system: 'BALADY', source: 'BALADY_GUIDE', title: 'الدخول إلى منصة بلدي',
    detail: 'إدخال رقم الهوية (هوية وطنية / هوية مقيم / رقم الحدود) وكلمة المرور، ثم رمز التحقق المرسل إلى الجوال. ويمكن الدخول عبر النفاذ الوطني الموحد.' },
  { code: 'FIND_SERVICE', no: 2, actor: 'APPLICANT', system: 'BALADY', source: 'BALADY_GUIDE', title: 'فتح خدمة «إصدار شهادة صحية»',
    detail: 'من قائمة الخدمات «عرض المزيد» ← البحث عن «الشهادات الصحية» ← «إصدار شهادة صحية» ← «التفاصيل»، ثم قراءة شاشة التعريف (طريقة التقديم، المتطلبات، الاشتراطات والغرامات) والضغط على «بدء الخدمة».' },
  { code: 'APPLICANT_SHOP', no: 3, actor: 'APPLICANT', system: 'BALADY', source: 'BALADY_GUIDE', title: 'صفة مقدم الطلب وموقع المحل',
    detail: 'اختيار الصفة (عن نفسه / مالك-مدير منشأة / مفوَّض)، وتحديد موقع المحل على الخريطة (المدينة، الحي، الشارع)، ثم المدينة والمركز الصحي. للمالك والمفوض: الرقم الموحد للمنشأة ثم «استعراض». عند اختيار أمانة الرياض أو الشرقية يُنقل المستخدم إلى موقع الأمانة.' },
  { code: 'ADD_WORKERS', no: 4, actor: 'APPLICANT', system: 'BALADY', source: 'BALADY_GUIDE', title: 'إضافة العاملين والتحقق منهم',
    detail: 'لكل عامل: رقم الهوية ونوع الهوية وتاريخ الميلاد ثم «تحقق»، فيُسترجع اسمه. بعدها رقم الجوال والمدينة والمركز الصحي ثم «إضافة». يمكن إضافة أكثر من عامل وحذف أي عامل. وإن لم تُسترجع مهنة المقيم أو صاحب رقم الحدود تُدخل يدوياً.' },
  { code: 'SUBMIT', no: 5, actor: 'APPLICANT', system: 'BALADY', trackedBy: 'request_no', source: 'BALADY_GUIDE', title: 'الإقرار وإرسال الطلب',
    detail: 'الموافقة على الإقرار بأن السعوديين يعملون لدى المنشأة وغير السعوديين على كفالتها، ثم «إرسال الطلب». يصل رقم الطلب برسالة SMS ويظهر في صفحة «طلباتي» بحالة الإجراء.' },
  { code: 'MEDICAL_EXAM', no: 6, actor: 'HEALTH_CENTER', system: 'SEHHA', trackedBy: 'exam_status', source: 'BALADY_FAQ', title: 'الكشف الطبي في مركز صحي معتمد',
    detail: 'يتوجه العامل إلى أقرب مركز صحي معتمد ويزوّده برقم الطلب. يحدّث المركز النتيجة على منصة «صحة»، فتتحدث حالة الفحص في بلدي آلياً إلى «لائق» أو «غير لائق». النتيجة «غير لائق» توقف الإصدار.' },
  { code: 'HEALTH_EDU', no: 7, actor: 'TRAINING_CENTER', system: 'TRAINING', trackedBy: 'edu_status', conditional: true, source: 'BALADY_FAQ', title: 'التثقيف الصحي والاختبار (حيث يُفعَّل)',
    detail: 'في الأمانات التي فعّلت البرنامج: الالتحاق بدورة التثقيف الصحي ثم اجتياز الاختبار. الرسوب: إعادة مجانية في المرة الأولى، ثم 150 ريالاً، ثم إعادة التسجيل في البرنامج.' },
  { code: 'PAY_FEE', no: 8, actor: 'APPLICANT', system: 'PAYMENT', trackedBy: 'fee_paid_on', source: 'BALADY_SERVICE', title: 'سداد رسوم الشهادة (60 ريالاً)',
    detail: 'سداد فاتورة الشهادة الصحية عبر سداد أو فيزا أو ماستر كارد أو مدى أو أبل باي.' },
  { code: 'ISSUE_PRINT', no: 9, actor: 'SYSTEM', system: 'BALADY', trackedBy: 'cert_expiry', source: 'BALADY_GUIDE', title: 'إصدار الشهادة وطباعتها',
    detail: 'تصبح حالة الطلب «منتهي» فتُطبع كل شهادة على حدة أو جميعها في ملف واحد. صلاحية الشهادة سنة، ويمكن تجديدها قبل انتهائها بـ 60 يوماً. سجّل بعدها تاريخ انتهاء الشهادة في سجل المنشأة.' },
];
