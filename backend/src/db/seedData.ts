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
] as const;

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
];

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
] as const;
