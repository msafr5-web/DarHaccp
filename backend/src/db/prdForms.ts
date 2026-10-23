import type { FormField } from '../models/haccp.model';

/**
 * Library forms from the technical PRD (HACCP & GDP — SFDA): warehouse management (WMS) and cold chain.
 * Every PRD constraint is expressed as a field rule so the same engine enforces it on mobile and web:
 *   - CCP alerts with conditional limits (chilled 2–8 °C / frozen ≤ −18 °C)        → limitsBy + critical
 *   - strict refusals (expiry_date > mfg_date, quantity ≥ 0, closing balance ≥ 0) → after / validMin
 *   - computed "virtual" fields (status, days remaining, closing balance)         → compute
 *   - opening balance carried from the previous month                             → carryFrom
 *   - one purchase order per shipment, one summary per item and month             → unique
 * Shipment / record ids and the receiving date-time are the record id and its timestamp.
 */

export interface CatalogSeed {
  code: string;
  titleAr: string;
  titleEn: string;
  description?: string;
  category: string;
  department: string | null;
  ccp: string | null;
  minDailyEntries?: number;
  isDefault: boolean;
  fields: FormField[];
}

const STATUS_LABELS = { Compliant: 'مطابق', 'Non-Compliant': 'غير مطابق' };
const EXPIRY_LABELS = { Safe: 'آمن', 'Expiring Soon': 'قارب على الانتهاء', Expired: 'منتهي الصلاحية' };

const CHILLED = 'مبرد (2–8°م)';
const FROZEN = 'مجمد (≤ -18°م)';
const AMBIENT = 'جاف / حرارة الغرفة';

export const prdForms: CatalogSeed[] = [
  {
    code: 'INBOUND_SHIPMENT', category: 'WMS_GDP', department: 'SUPPORT', ccp: null, isDefault: false,
    titleAr: 'استلام وفحص الإرساليات', titleEn: 'Inbound receiving & inspection',
    description: 'فحص الشاحنات الواردة: درجة حرارة النقل (CCP) والتغليف وقرار القبول — PRD §2',
    fields: [
      { key: 'po_number', labelAr: 'رقم أمر الشراء (ERP)', labelEn: 'PO number', type: 'text', required: true, unique: true,
        pattern: '^[A-Za-z0-9][A-Za-z0-9/-]{2,39}$', patternMessage: 'رقم أمر الشراء: أحرف وأرقام فقط (3–40)',
        hint: 'فريد لكل شحنة ومطابق لنظام ERP' },
      { key: 'supplier_name', labelAr: 'المورد المعتمد', labelEn: 'Approved supplier', type: 'select', options: [], companyOptions: true,
        required: true, hint: 'من القائمة المؤهلة للموردين' },
      { key: 'product_category', labelAr: 'فئة المنتج', labelEn: 'Product category', type: 'select', required: true,
        options: [CHILLED, FROZEN, AMBIENT] },
      { key: 'vehicle_temp', labelAr: 'درجة حرارة شاحنة النقل', labelEn: 'Vehicle temperature', type: 'number', unit: '°C',
        required: true, critical: true, validMin: -40, validMax: 60,
        limitsBy: { field: 'product_category', cases: { [CHILLED]: { min: 2, max: 8 }, [FROZEN]: { max: -18 } } } },
      { key: 'packaging_intact', labelAr: 'التغليف سليم', labelEn: 'Packaging intact', type: 'boolean', required: true, expected: true },
      { key: 'transport_status', labelAr: 'حالة النقل', labelEn: 'Transport status', type: 'select',
        options: ['Compliant', 'Non-Compliant'], optionLabels: STATUS_LABELS, compute: { kind: 'compliance', fields: ['vehicle_temp'] } },
      { key: 'acceptance_status', labelAr: 'قرار الاستلام', labelEn: 'Acceptance status', type: 'select', required: true,
        options: ['Accepted', 'Rejected'], optionLabels: { Accepted: 'مقبولة', Rejected: 'مرفوضة' }, onCriticalDeviation: 'Rejected',
        hint: 'تُرفض الشحنة إلزامياً عند تجاوز حرارة النقل' },
    ],
  },
  {
    code: 'BATCH_INSPECTION', category: 'WMS_GDP', department: 'SUPPORT', ccp: null, isDefault: false,
    titleAr: 'فحص وتدقيق الواردات والدفعات', titleEn: 'Batch inspection & CoA',
    description: 'تتبع أرقام التشغيلات وتواريخ الصلاحية وشهادات التحليل (GDP/GMP) — PRD §3',
    fields: [
      { key: 'item_code', labelAr: 'كود الصنف (Item Master)', labelEn: 'Item code', type: 'text', required: true },
      { key: 'item_name', labelAr: 'اسم الصنف', labelEn: 'Item name', type: 'text', required: true },
      { key: 'batch_number', labelAr: 'رقم التشغيلة (Lot / Batch)', labelEn: 'Batch number', type: 'text', required: true,
        hint: 'أساس التتبع العكسي وسحب المنتجات (Recall)' },
      { key: 'mfg_date', labelAr: 'تاريخ الإنتاج', labelEn: 'Manufacturing date', type: 'date', required: true },
      { key: 'expiry_date', labelAr: 'تاريخ الانتهاء', labelEn: 'Expiry date', type: 'date', required: true, after: 'mfg_date',
        hint: 'يجب أن يكون بعد تاريخ الإنتاج حصراً، وإلا يُرفض الإدخال' },
      { key: 'coa_verified', labelAr: 'تم التحقق من شهادة التحليل (CoA)', labelEn: 'CoA verified', type: 'boolean',
        required: true, expected: true, critical: true, hint: 'شرط أساسي لاعتماد الشحنة' },
    ],
  },
  {
    code: 'ENV_MONITORING', category: 'WMS_GDP', department: null, ccp: null, isDefault: false, minDailyEntries: 2,
    titleAr: 'المراقبة البيئية اليومية — نقاط التحكم الحرجة', titleEn: 'Environmental monitoring (CCP)',
    description: 'رصد الحرارة والرطوبة لمستودعات التبريد والتجميد والمستودع الجاف مرتين يومياً كحد أدنى — PRD §4',
    fields: [
      { key: 'zone_location', labelAr: 'المنطقة / المستودع', labelEn: 'Zone location', type: 'text', required: true, prefill: 'equipment.location' },
      { key: 'sensor_id', labelAr: 'كود الحساس / مسجل البيانات', labelEn: 'Sensor / data logger id', type: 'text', required: true,
        prefill: 'equipment.code' },
      { key: 'zone_type', labelAr: 'نوع المنطقة', labelEn: 'Zone type', type: 'select', required: true,
        options: ['مستودع تبريد (2–8°م)', 'مستودع تجميد (≤ -18°م)', 'مستودع جاف (≤ 25°م)'] },
      { key: 'actual_temp', labelAr: 'درجة الحرارة الفعلية', labelEn: 'Actual temperature', type: 'number', unit: '°C',
        required: true, critical: true, validMin: -50, validMax: 70,
        limitsBy: { field: 'zone_type', cases: {
          'مستودع تبريد (2–8°م)': { min: 2, max: 8 }, 'مستودع تجميد (≤ -18°م)': { max: -18 }, 'مستودع جاف (≤ 25°م)': { max: 25 },
        } } },
      { key: 'humidity', labelAr: 'الرطوبة النسبية', labelEn: 'Relative humidity', type: 'number', unit: '%', required: true,
        validMin: 0, validMax: 100,
        limitsBy: { field: 'zone_type', cases: { 'مستودع جاف (≤ 25°م)': { max: 60 } } } },
      { key: 'compliance_status', labelAr: 'حالة المطابقة', labelEn: 'Compliance status', type: 'select',
        options: ['Compliant', 'Non-Compliant'], optionLabels: STATUS_LABELS, compute: { kind: 'compliance', fields: ['actual_temp', 'humidity'] } },
    ],
  },
  {
    code: 'INVENTORY_STOCK', category: 'WMS_GDP', department: 'SUPPORT', ccp: null, isDefault: false,
    titleAr: 'مراقبة المخزون والصلاحية (FEFO)', titleEn: 'Inventory stock & expiry (FEFO)',
    description: 'الأرصدة الحالية والأيام المتبقية للصلاحية مع الإنذار المبكر — PRD §5',
    fields: [
      { key: 'item_code', labelAr: 'كود الصنف', labelEn: 'Item code', type: 'text', required: true },
      { key: 'batch_number', labelAr: 'رقم التشغيلة', labelEn: 'Batch number', type: 'text', required: true },
      { key: 'expiry_date', labelAr: 'تاريخ الانتهاء', labelEn: 'Expiry date', type: 'date', required: true },
      { key: 'current_quantity', labelAr: 'الكمية الحالية', labelEn: 'Current quantity', type: 'number', required: true, validMin: 0,
        hint: 'لا تُقبل القيم السالبة' },
      { key: 'days_remaining', labelAr: 'الأيام المتبقية للصلاحية', labelEn: 'Days remaining', type: 'number', unit: 'يوم',
        compute: { kind: 'daysUntil', field: 'expiry_date' } },
      { key: 'expiry_alert_status', labelAr: 'حالة الصلاحية (FEFO)', labelEn: 'Expiry alert status', type: 'select',
        options: ['Safe', 'Expiring Soon', 'Expired'], optionLabels: EXPIRY_LABELS,
        compute: { kind: 'expiryStatus', field: 'expiry_date', warnDays: 7 } },
    ],
  },
  {
    code: 'MONTHLY_CONSUMPTION', category: 'WMS_GDP', department: 'SUPPORT', ccp: null, isDefault: false,
    titleAr: 'ملخص الاستهلاك والتدوير الشهري', titleEn: 'Monthly consumption & waste',
    description: 'حركة المخزون الشهرية وإغلاق الفترة ومؤشر الالتزام بسياسة FEFO — PRD §6',
    fields: [
      { key: 'period_month', labelAr: 'الشهر', labelEn: 'Period (month)', type: 'month', required: true, unique: true, uniqueWith: ['item_code'] },
      { key: 'item_code', labelAr: 'كود الصنف', labelEn: 'Item code', type: 'text', required: true },
      { key: 'opening_balance', labelAr: 'الرصيد الافتتاحي', labelEn: 'Opening balance', type: 'number', required: true, validMin: 0,
        carryFrom: 'closing_balance', carryMatch: ['item_code'], hint: 'يُرحَّل آلياً من الرصيد الختامي للشهر السابق لنفس الصنف' },
      { key: 'inbound_qty', labelAr: 'الوارد خلال الشهر', labelEn: 'Inbound', type: 'number', required: true, validMin: 0 },
      { key: 'actual_consumption', labelAr: 'المنصرف الفعلي', labelEn: 'Actual consumption', type: 'number', required: true, validMin: 0 },
      { key: 'waste_qty', labelAr: 'الهالك والمرفوض', labelEn: 'Waste quantity', type: 'number', required: true, validMin: 0 },
      { key: 'closing_balance', labelAr: 'الرصيد الختامي', labelEn: 'Closing balance', type: 'number', validMin: 0,
        compute: { kind: 'sum', terms: [
          { field: 'opening_balance', sign: 1 }, { field: 'inbound_qty', sign: 1 },
          { field: 'actual_consumption', sign: -1 }, { field: 'waste_qty', sign: -1 },
        ] } },
      { key: 'fefo_compliance_rate', labelAr: 'نسبة الالتزام بسياسة FEFO', labelEn: 'FEFO compliance rate', type: 'number', unit: '%',
        required: true, validMin: 0, validMax: 100, min: 95, hint: 'المستهدف ≥ 95%' },
    ],
  },
];
