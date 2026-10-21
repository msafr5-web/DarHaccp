import type { FormField } from '../models/haccp.model';

/** Reference HACCP plan for Dar Al Dhiafa central kitchens (editable later via the API). */

export const departments = [
  { code: 'HOT', nameAr: 'المطبخ الساخن', nameEn: 'Hot Kitchen' },
  { code: 'COLD', nameAr: 'المطبخ البارد', nameEn: 'Cold Kitchen' },
  { code: 'SWEETS', nameAr: 'قسم الحلويات', nameEn: 'Pastry & Sweets' },
  { code: 'SUPPORT', nameAr: 'الخدمات المساندة', nameEn: 'Support Services' },
] as const;

export const ccps = [
  {
    code: 'CCP-1', nameAr: 'الطهي — درجة الحرارة الداخلية', nameEn: 'Cooking — core temperature', department: 'HOT',
    hazard: 'Survival of pathogens (Salmonella, E. coli O157:H7, Listeria) due to under-cooking',
    min: 75, max: null, unit: '°C', frequency: 'Every batch',
    action: 'Continue cooking until core temperature ≥ 75°C, re-measure and record. Hold the batch until compliant.',
  },
  {
    code: 'CCP-2', nameAr: 'التخزين المبرد', nameEn: 'Chilled storage', department: null,
    hazard: 'Growth of pathogens in chilled food stored above 4°C',
    min: null, max: 4, unit: '°C', frequency: 'Every 4 hours',
    action: 'Move food to a compliant fridge, assess time above limit (>2h above 5°C = discard), call maintenance.',
  },
  {
    code: 'CCP-3', nameAr: 'الحفظ الساخن', nameEn: 'Hot holding', department: 'HOT',
    hazard: 'Growth of spore-forming bacteria (Bacillus cereus, Clostridium perfringens) below 63°C',
    min: 63, max: null, unit: '°C', frequency: 'Every 2 hours',
    action: 'Reheat to ≥ 75°C within 1 hour if held < 2h below 63°C, otherwise discard.',
  },
  {
    code: 'CCP-4', nameAr: 'استلام اللحوم والدواجن المبردة', nameEn: 'Receiving chilled meat & poultry', department: 'SUPPORT',
    hazard: 'Pathogen growth due to temperature abuse during transport',
    min: null, max: 4, unit: '°C', frequency: 'Every delivery',
    action: 'Reject the delivery, record supplier non-conformance and notify purchasing.',
  },
  {
    code: 'CCP-5', nameAr: 'تعقيم الخضار والفواكه', nameEn: 'Vegetable & fruit sanitisation', department: 'COLD',
    hazard: 'Pathogens on raw produce served without cooking',
    min: 50, max: 200, unit: 'ppm', frequency: 'Every sanitising batch',
    action: 'Adjust the chlorine solution to 50–200 ppm and re-sanitise the batch for the full contact time.',
  },
  {
    code: 'CCP-6', nameAr: 'التخزين المجمد', nameEn: 'Frozen storage', department: null,
    hazard: 'Thawing and pathogen growth in frozen products',
    min: null, max: -18, unit: '°C', frequency: 'Twice per shift',
    action: 'Transfer products to a compliant freezer, assess thaw state, call maintenance.',
  },
  {
    code: 'CCP-7', nameAr: 'التبريد السريع (60°م ← 4°م خلال 6 ساعات)', nameEn: 'Blast chilling (60°C → 4°C within 6 h)', department: 'HOT',
    hazard: 'Germination and growth of spore-formers (C. perfringens, B. cereus) in the 60–4°C danger zone',
    min: null, max: 4, unit: '°C', frequency: 'Every batch',
    action: 'If 4°C is not reached within 6 hours: discard the batch. If < 2 h over, reheat to ≥ 75°C and restart chilling.',
  },
  {
    code: 'CCP-8', nameAr: 'طهي وخبز الحلويات (الكريمات والكاسترد)', nameEn: 'Confectionery cooking / baking', department: 'SWEETS',
    hazard: 'Survival of Salmonella from eggs and dairy in creams, custards and fillings',
    min: 75, max: null, unit: '°C', frequency: 'Every batch',
    action: 'Continue cooking/baking until core ≥ 75°C; if not achievable, discard the batch.',
  },
] as const;

/** Hazard classification per CCP (PRD §3 hazard_type). */
export const ccpHazardTypes: Record<string, 'BIOLOGICAL' | 'CHEMICAL' | 'PHYSICAL' | 'ALLERGEN'> = {
  'CCP-1': 'BIOLOGICAL', 'CCP-2': 'BIOLOGICAL', 'CCP-3': 'BIOLOGICAL', 'CCP-4': 'BIOLOGICAL',
  'CCP-5': 'CHEMICAL', 'CCP-6': 'BIOLOGICAL', 'CCP-7': 'BIOLOGICAL', 'CCP-8': 'BIOLOGICAL',
};

type TemplateSeed = {
  code: string; titleAr: string; titleEn: string; department: string | null; ccp: string | null; fields: FormField[];
};

const yes = (key: string, labelAr: string, labelEn: string): FormField => ({ key, labelAr, labelEn, type: 'boolean', required: true, expected: true });

export const templates: TemplateSeed[] = [
  {
    code: 'COOKING_CCP1', titleAr: 'سجل درجة حرارة الطهي', titleEn: 'Cooking temperature log', department: 'HOT', ccp: 'CCP-1',
    fields: [
      { key: 'product', labelAr: 'الصنف', labelEn: 'Product', type: 'text', required: true },
      { key: 'core_temp', labelAr: 'درجة الحرارة الداخلية', labelEn: 'Core temperature', type: 'number', ccpMeasurement: true },
      yes('probe_sanitized', 'تم تعقيم مقياس الحرارة', 'Probe sanitised'),
    ],
  },
  {
    code: 'HOT_HOLDING', titleAr: 'سجل الحفظ الساخن', titleEn: 'Hot holding log', department: 'HOT', ccp: 'CCP-3',
    fields: [
      { key: 'product', labelAr: 'الصنف', labelEn: 'Product', type: 'text', required: true },
      { key: 'holding_temp', labelAr: 'درجة حرارة الحفظ', labelEn: 'Holding temperature', type: 'number', ccpMeasurement: true },
      { key: 'holding_unit', labelAr: 'وحدة الحفظ', labelEn: 'Holding unit', type: 'select', options: ['Bain-marie', 'Hot box', 'Oven'], required: true },
    ],
  },
  {
    code: 'FRIDGE_CHECK', titleAr: 'فحص الثلاجة', titleEn: 'Fridge check', department: null, ccp: 'CCP-2',
    fields: [
      { key: 'air_temp', labelAr: 'درجة حرارة الثلاجة', labelEn: 'Fridge temperature', type: 'number', ccpMeasurement: true },
      yes('door_seal_ok', 'إحكام الباب سليم', 'Door seal intact'),
      yes('raw_cooked_separated', 'فصل النيء عن المطبوخ', 'Raw / cooked separated'),
      yes('labels_dated', 'جميع العبوات مؤرخة ومُلصقة', 'All containers labelled & dated'),
      yes('clean', 'الثلاجة نظيفة', 'Fridge clean'),
    ],
  },
  {
    code: 'FREEZER_CHECK', titleAr: 'فحص الفريزر', titleEn: 'Freezer check', department: null, ccp: 'CCP-6',
    fields: [
      { key: 'air_temp', labelAr: 'درجة حرارة الفريزر', labelEn: 'Freezer temperature', type: 'number', ccpMeasurement: true },
      yes('no_ice_buildup', 'لا يوجد تراكم ثلج', 'No ice build-up'),
      yes('packaging_sealed', 'العبوات مغلقة', 'Packaging sealed'),
    ],
  },
  {
    code: 'MEAT_RECEIVING', titleAr: 'استلام اللحوم والدواجن', titleEn: 'Meat & poultry receiving', department: 'SUPPORT', ccp: 'CCP-4',
    fields: [
      { key: 'supplier', labelAr: 'المورد', labelEn: 'Supplier', type: 'text', required: true },
      { key: 'invoice_no', labelAr: 'رقم الفاتورة', labelEn: 'Invoice no.', type: 'text', required: true },
      { key: 'product_temp', labelAr: 'درجة حرارة المنتج', labelEn: 'Product temperature', type: 'number', ccpMeasurement: true },
      { key: 'vehicle_temp', labelAr: 'درجة حرارة المركبة', labelEn: 'Vehicle temperature', type: 'number', unit: '°C', max: 4, required: true },
      { key: 'expiry_date', labelAr: 'تاريخ الانتهاء', labelEn: 'Expiry date', type: 'date', required: true },
      yes('packaging_intact', 'التغليف سليم', 'Packaging intact'),
      yes('halal_certificate', 'شهادة الذبح الحلال متوفرة', 'Halal certificate available'),
      yes('sfda_label', 'بطاقة البيانات مطابقة (SFDA)', 'Label compliant (SFDA)'),
    ],
  },
  {
    code: 'VEG_SANITIZATION', titleAr: 'تعقيم الخضار والفواكه', titleEn: 'Vegetable sanitisation', department: 'COLD', ccp: 'CCP-5',
    fields: [
      { key: 'produce', labelAr: 'نوع الخضار / الفاكهة', labelEn: 'Produce', type: 'text', required: true },
      { key: 'chlorine_ppm', labelAr: 'تركيز الكلور', labelEn: 'Chlorine concentration', type: 'number', ccpMeasurement: true },
      { key: 'contact_minutes', labelAr: 'زمن التلامس (دقيقة)', labelEn: 'Contact time (min)', type: 'number', unit: 'min', min: 5, required: true },
      yes('rinsed', 'تم الشطف بماء صالح للشرب', 'Rinsed with potable water'),
    ],
  },
  {
    code: 'SWEETS_CHILLER', titleAr: 'فحص ثلاجة الحلويات', titleEn: 'Pastry chiller check', department: 'SWEETS', ccp: 'CCP-2',
    fields: [
      { key: 'air_temp', labelAr: 'درجة الحرارة', labelEn: 'Temperature', type: 'number', ccpMeasurement: true },
      yes('cream_products_covered', 'منتجات الكريمة مغطاة', 'Cream products covered'),
      yes('labels_dated', 'العبوات مؤرخة', 'Containers dated'),
    ],
  },
  {
    code: 'HEALTH_CERT_CHECK', titleAr: 'فحص الشهادات الصحية والنظافة الشخصية', titleEn: 'Health certificate & hygiene check', department: null, ccp: null,
    fields: [
      { key: 'employee_no', labelAr: 'الرقم الوظيفي', labelEn: 'Employee no.', type: 'text', required: true },
      yes('certificate_valid', 'الشهادة الصحية سارية', 'Health certificate valid'),
      yes('no_illness_symptoms', 'لا توجد أعراض مرضية', 'No illness symptoms'),
      yes('uniform_clean', 'الزي نظيف وكامل', 'Clean full uniform'),
      yes('no_jewelry', 'بدون مجوهرات', 'No jewellery'),
      yes('wounds_covered', 'الجروح مغطاة (أو لا يوجد)', 'Wounds covered (or none)'),
    ],
  },
  {
    code: 'BLAST_CHILLING', titleAr: 'سجل التبريد السريع', titleEn: 'Blast chilling log', department: 'HOT', ccp: 'CCP-7',
    fields: [
      { key: 'product', labelAr: 'الصنف', labelEn: 'Product', type: 'text', required: true },
      { key: 'start_temp', labelAr: 'الحرارة عند بدء التبريد', labelEn: 'Start temperature', type: 'number', unit: '°C', min: 60, required: true },
      { key: 'start_time', labelAr: 'وقت بدء التبريد', labelEn: 'Start time', type: 'time', required: true },
      { key: 'end_temp', labelAr: 'الحرارة عند نهاية التبريد', labelEn: 'End temperature', type: 'number', ccpMeasurement: true },
      { key: 'end_time', labelAr: 'وقت الوصول إلى 4°م', labelEn: 'Time 4°C reached', type: 'time', required: true,
        durationFrom: 'start_time', maxMinutes: 360, critical: true },
    ],
  },
  {
    code: 'SWEETS_BAKING', titleAr: 'سجل طهي وخبز الحلويات', titleEn: 'Confectionery cooking & baking', department: 'SWEETS', ccp: 'CCP-8',
    fields: [
      { key: 'product', labelAr: 'الصنف', labelEn: 'Product', type: 'text', required: true },
      { key: 'core_temp', labelAr: 'درجة الحرارة الداخلية', labelEn: 'Core temperature', type: 'number', ccpMeasurement: true },
      { key: 'baking_minutes', labelAr: 'مدة الخبز (دقيقة)', labelEn: 'Baking time (min)', type: 'number', unit: 'min', required: true },
      yes('probe_sanitized', 'تم تعقيم مقياس الحرارة', 'Probe sanitised'),
    ],
  },
  {
    code: 'SWEETS_RAW_MATERIALS', titleAr: 'فحص خامات الألبان والبيض', titleEn: 'Dairy & egg raw materials check', department: 'SWEETS', ccp: null,
    fields: [
      { key: 'material', labelAr: 'الخامة', labelEn: 'Material', type: 'select', options: ['حليب', 'قشطة', 'زبدة', 'بيض', 'جبن كريمي', 'كريمة خفق'], required: true },
      { key: 'supplier', labelAr: 'المورد', labelEn: 'Supplier', type: 'text', required: true },
      { key: 'storage_temp', labelAr: 'درجة حرارة الحفظ', labelEn: 'Storage temperature', type: 'number', unit: '°C', max: 5, required: true, critical: true },
      { key: 'expiry_date', labelAr: 'تاريخ الانتهاء', labelEn: 'Expiry date', type: 'date', required: true },
      yes('within_expiry', 'الخامة ضمن الصلاحية', 'Within expiry date'),
      yes('packaging_intact', 'التغليف سليم', 'Packaging intact'),
    ],
  },
  {
    code: 'SWEETS_COOLING_PACKING', titleAr: 'تبريد وتعبئة الحلويات', titleEn: 'Pastry cooling & packing', department: 'SWEETS', ccp: 'CCP-2',
    fields: [
      { key: 'product', labelAr: 'الصنف', labelEn: 'Product', type: 'text', required: true },
      { key: 'product_temp', labelAr: 'حرارة المنتج قبل التعبئة', labelEn: 'Product temperature', type: 'number', ccpMeasurement: true },
      yes('data_card_attached', 'تم إرفاق بطاقة البيانات', 'Data card attached'),
      yes('packaging_clean', 'العبوات نظيفة ومحكمة', 'Packaging clean & sealed'),
    ],
  },
  {
    code: 'RETURNS_DISPOSAL', titleAr: 'إتلاف مرتجعات المناسبات', titleEn: 'Event returns disposal', department: null, ccp: null,
    fields: [
      { key: 'event_name', labelAr: 'المناسبة / المعرض', labelEn: 'Event', type: 'text', required: true },
      { key: 'item', labelAr: 'الصنف المرتجع', labelEn: 'Returned item', type: 'text', required: true },
      { key: 'quantity', labelAr: 'الكمية (كغ)', labelEn: 'Quantity (kg)', type: 'number', unit: 'kg', required: true },
      { key: 'disposal_method', labelAr: 'طريقة الإتلاف', labelEn: 'Disposal method', type: 'select',
        options: ['حاوية النفايات العضوية', 'شركة نفايات معتمدة', 'إتلاف بحضور مشرف'], required: true },
      yes('disposed_confirmed', 'تم الإتلاف فعلياً', 'Disposal completed'),
      { key: 're_entered_to_stock', labelAr: 'هل أُعيد أي جزء للمخزون أو الاستخدام؟', labelEn: 'Any part re-entered to stock?', type: 'boolean',
        required: true, expected: false, critical: true },
      { key: 'witness_employee_no', labelAr: 'الرقم الوظيفي للشاهد', labelEn: 'Witness employee no.', type: 'text', required: true },
    ],
  },
  {
    code: 'STAFF_DAILY_HEALTH', titleAr: 'الفحص الصحي اليومي للعاملين', titleEn: 'Staff daily health check', department: null, ccp: null,
    fields: [
      { key: 'employee_no', labelAr: 'الرقم الوظيفي', labelEn: 'Employee no.', type: 'text', required: true },
      { key: 'body_temp', labelAr: 'درجة حرارة الجسم', labelEn: 'Body temperature', type: 'number', unit: '°C', max: 37.5, required: true, critical: true },
      yes('no_symptoms', 'لا توجد أعراض (إسهال، قيء، حمى، التهاب جلدي)', 'No symptoms'),
      yes('hands_ok', 'اليدان سليمتان والجروح مغطاة', 'Hands OK / wounds covered'),
      yes('uniform_ok', 'الزي نظيف وكامل', 'Clean full uniform'),
    ],
  },
  {
    code: 'SAFETY_DAILY', titleAr: 'جولة السلامة والطوارئ اليومية', titleEn: 'Daily safety & emergency round', department: 'SUPPORT', ccp: null,
    fields: [
      yes('extinguishers_in_place', 'طفايات الحريق في أماكنها حسب المخطط', 'Extinguishers in place per layout'),
      yes('extinguishers_pressure_ok', 'ضغط الطفايات ضمن النطاق الأخضر', 'Extinguisher pressure OK'),
      yes('exits_clear', 'مخارج الطوارئ ومسارات الإخلاء غير معاقة', 'Emergency exits clear'),
      yes('emergency_lighting_ok', 'إنارة الطوارئ تعمل', 'Emergency lighting working'),
      yes('gas_leak_check_ok', 'لا يوجد تسرب غاز', 'No gas leak'),
      yes('first_aid_ok', 'حقيبة الإسعافات مكتملة', 'First aid kit complete'),
      yes('cctv_ok', 'جميع كاميرات المراقبة تعمل وتسجل', 'All CCTV cameras recording'),
    ],
  },
  {
    code: 'VEHICLE_CHECK', titleAr: 'فحص سيارة نقل الأغذية', titleEn: 'Food transport vehicle check', department: 'SUPPORT', ccp: null,
    fields: [
      { key: 'compartment_temp', labelAr: 'حرارة صندوق التبريد', labelEn: 'Cargo temperature', type: 'number', unit: '°C', max: 4, required: true, critical: true },
      yes('vehicle_clean', 'الصندوق نظيف ومعقم', 'Cargo area clean & sanitised'),
      yes('no_mixed_loads', 'لا توجد حمولات غير غذائية', 'No non-food loads'),
      yes('driver_cert_valid', 'الشهادة الصحية للسائق سارية', 'Driver health certificate valid'),
      { key: 'odometer', labelAr: 'قراءة العداد', labelEn: 'Odometer', type: 'number', unit: 'km' },
    ],
  },
  {
    code: 'PEST_CONTROL_VISIT', titleAr: 'زيارة مكافحة الآفات', titleEn: 'Pest control visit', department: 'SUPPORT', ccp: null,
    fields: [
      { key: 'contractor', labelAr: 'الشركة المنفذة', labelEn: 'Contractor', type: 'text', required: true },
      yes('approved_chemicals', 'المبيدات المستخدمة معتمدة من الجهات المختصة', 'Approved chemicals used'),
      yes('stations_checked', 'تم فحص جميع محطات الطعوم والمصائد', 'All bait stations checked'),
      { key: 'pest_activity', labelAr: 'هل وُجد نشاط للآفات؟', labelEn: 'Pest activity found?', type: 'boolean', required: true, expected: false },
      yes('report_received', 'تم استلام تقرير الزيارة', 'Visit report received'),
    ],
  },
];

export const recipes = [
  {
    code: 'SW-KUNAFA', nameAr: 'كنافة بالقشطة', nameEn: 'Kunafa with cream', department: 'SWEETS', shelfLifeHours: 24, storageTempMax: 4,
    ingredients: [{ name: 'عجينة كنافة' }, { name: 'قشطة' }, { name: 'زبدة' }, { name: 'قطر (شيرة)' }, { name: 'فستق حلبي' }],
    allergens: ['حليب', 'جلوتين', 'مكسرات'], storage: 'تحفظ مبردة عند 4°م أو أقل', ccp: 'طهي القشطة ≥ 75°م (CCP-8)',
  },
  {
    code: 'SW-MAAMOUL', nameAr: 'معمول بالتمر', nameEn: 'Date maamoul', department: 'SWEETS', shelfLifeHours: 336, storageTempMax: null,
    ingredients: [{ name: 'سميد' }, { name: 'طحين' }, { name: 'زبدة' }, { name: 'عجوة تمر' }, { name: 'ماء ورد' }],
    allergens: ['جلوتين', 'حليب'], storage: 'يحفظ في مكان جاف بعيداً عن الحرارة والرطوبة', ccp: null,
  },
  {
    code: 'SW-CREME-CARAMEL', nameAr: 'كريم كراميل', nameEn: 'Crème caramel', department: 'SWEETS', shelfLifeHours: 48, storageTempMax: 4,
    ingredients: [{ name: 'حليب' }, { name: 'بيض' }, { name: 'سكر' }, { name: 'فانيليا' }],
    allergens: ['حليب', 'بيض'], storage: 'تحفظ مبردة عند 4°م أو أقل', ccp: 'خبز حتى ≥ 75°م ثم تبريد سريع',
  },
  {
    code: 'CK-FATTOUSH', nameAr: 'سلطة فتوش', nameEn: 'Fattoush salad', department: 'COLD', shelfLifeHours: 12, storageTempMax: 4,
    ingredients: [{ name: 'خس' }, { name: 'طماطم' }, { name: 'خيار' }, { name: 'خبز محمص' }, { name: 'دبس رمان' }, { name: 'سماق' }],
    allergens: ['جلوتين'], storage: 'تحفظ مبردة عند 4°م أو أقل — الخضار معقمة (CCP-5)', ccp: 'تعقيم الخضار 50–200 ppm',
  },
] as const;

export const staff = [
  { employeeNo: 'DD-3001', fullName: 'شيف المطبخ الساخن', nationality: 'مصر', idNumber: '2412345678', jobTitle: 'شيف أول', department: 'HOT' },
  { employeeNo: 'DD-3002', fullName: 'شيف المطبخ البارد', nationality: 'الهند', idNumber: '2398765432', jobTitle: 'شيف', department: 'COLD' },
  { employeeNo: 'DD-3003', fullName: 'شيف الحلويات', nationality: 'سوريا', idNumber: '2455511223', jobTitle: 'شيف حلويات', department: 'SWEETS' },
  { employeeNo: 'DD-4001', fullName: 'عامل الخدمات المساندة', nationality: 'بنغلاديش', idNumber: '2377788899', jobTitle: 'عامل نظافة', department: 'SUPPORT' },
  { employeeNo: 'DD-4002', fullName: 'سائق نقل الأغذية', nationality: 'السعودية', idNumber: '1088877766', jobTitle: 'سائق', department: 'SUPPORT' },
] as const;

export const contractors = [
  { name: 'شركة البيئة الآمنة لمكافحة الآفات', service: 'PEST_CONTROL', cr: '1010123456', license: 'PC-2025-7781', licenseDays: 200, contractDays: 300 },
  { name: 'مؤسسة التبريد المتقدم للصيانة', service: 'MAINTENANCE', cr: '1010654321', license: 'MT-2024-1102', licenseDays: 20, contractDays: 120 },
  { name: 'شركة نقاء لإدارة النفايات', service: 'WASTE_DISPOSAL', cr: '1010998877', license: 'WD-2025-0450', licenseDays: 400, contractDays: 365 },
] as const;

export const documents = [
  { docNo: 'IMS-POL-001', title: 'سياسة النظام المتكامل (الجودة وسلامة الغذاء والسلامة المهنية)', category: 'IMS_POLICY', department: null, reviewDays: 300 },
  { docNo: 'HACCP-PLAN-001', title: 'خطة الهاسب للمطبخ المركزي', category: 'HACCP_PLAN', department: null, reviewDays: 150 },
  { docNo: 'EMR-EVAC-001', title: 'خطة الإخلاء ومسارات الطوارئ', category: 'EVACUATION_PLAN', department: 'SUPPORT', reviewDays: 25 },
  { docNo: 'EMR-FIRE-001', title: 'مخطط توزيع طفايات الحريق', category: 'FIRE_EXTINGUISHER_LAYOUT', department: 'SUPPORT', reviewDays: 90 },
  { docNo: 'SOP-COLD-002', title: 'إجراء منع التلوث المتبادل وإتلاف المرتجعات', category: 'SOP', department: 'COLD', reviewDays: 180 },
] as const;

export const users = [
  { employeeNo: 'DD-1001', fullName: 'مسؤول سلامة الغذاء', email: 'haccp@daraldhiafa.sa', role: 'HACCP_OFFICER', department: null },
  { employeeNo: 'DD-1002', fullName: 'مسؤول الصحة والسلامة المهنية', email: 'hse@daraldhiafa.sa', role: 'HSE_OFFICER', department: null },
  { employeeNo: 'DD-2001', fullName: 'مشرف المطبخ الساخن', email: 'hot.supervisor@daraldhiafa.sa', role: 'KITCHEN_SUPERVISOR', department: 'HOT' },
  { employeeNo: 'DD-2002', fullName: 'مشرف المطبخ البارد', email: 'cold.supervisor@daraldhiafa.sa', role: 'KITCHEN_SUPERVISOR', department: 'COLD' },
  { employeeNo: 'DD-2003', fullName: 'مشرف الحلويات', email: 'sweets.supervisor@daraldhiafa.sa', role: 'KITCHEN_SUPERVISOR', department: 'SWEETS' },
  { employeeNo: 'DD-2004', fullName: 'مشرف الخدمات المساندة', email: 'support.supervisor@daraldhiafa.sa', role: 'KITCHEN_SUPERVISOR', department: 'SUPPORT' },
  { employeeNo: 'DD-3001', fullName: 'شيف المطبخ الساخن', email: 'hot.chef@daraldhiafa.sa', role: 'CHEF', department: 'HOT' },
  { employeeNo: 'DD-3002', fullName: 'شيف المطبخ البارد', email: 'cold.chef@daraldhiafa.sa', role: 'CHEF', department: 'COLD' },
] as const;

export const equipment = [
  { code: 'FR-COLD-01', name: 'Walk-in chiller 1', type: 'FRIDGE', department: 'COLD', location: 'Cold kitchen — store A', template: 'FRIDGE_CHECK', interval: 90 },
  { code: 'FZ-COLD-01', name: 'Walk-in freezer 1', type: 'FREEZER', department: 'COLD', location: 'Cold kitchen — store B', template: 'FREEZER_CHECK', interval: 90 },
  { code: 'FR-SWT-01', name: 'Pastry chiller', type: 'FRIDGE', department: 'SWEETS', location: 'Pastry room', template: 'SWEETS_CHILLER', interval: 90 },
  { code: 'OV-HOT-01', name: 'Combi oven 1', type: 'OVEN', department: 'HOT', location: 'Hot line 1', template: 'COOKING_CCP1', interval: 180 },
  { code: 'BM-HOT-01', name: 'Bain-marie 1', type: 'HOT_HOLDING', department: 'HOT', location: 'Dispatch', template: 'HOT_HOLDING', interval: 180 },
  { code: 'FR-SUP-01', name: 'Receiving chiller', type: 'FRIDGE', department: 'SUPPORT', location: 'Receiving bay', template: 'FRIDGE_CHECK', interval: 90 },
  { code: 'BC-HOT-01', name: 'Blast chiller 1', type: 'BLAST_CHILLER', department: 'HOT', location: 'Hot kitchen — chilling area', template: 'BLAST_CHILLING', interval: 90 },
  { code: 'VAN-01', name: 'Refrigerated van 1', type: 'VEHICLE', department: 'SUPPORT', location: 'Fleet', template: 'VEHICLE_CHECK', interval: 60 },
] as const;
