import type { FormField } from '../models/haccp.model';

/**
 * Library forms from the technical PRD (HACCP & GDP — SFDA): warehouse management (WMS) and cold chain.
 * Every PRD constraint is expressed as a field rule so the same engine enforces it on mobile and web:
 *   - CCP alerts with conditional limits (chilled 2–8 °C / frozen ≤ −18 °C)        → limitsBy + critical
 *   - strict refusals (expiry_date > mfg_date, quantity ≥ 0, closing balance ≥ 0) → after / validMin
 *   - computed "virtual" fields (status, days remaining, closing balance)         → compute
 *   - opening balance carried from the previous month                             → carryFrom
 *   - one purchase order per shipment, one summary per item and month             → unique
 *   - item codes from the item master (foreign key)                               → itemRef
 *   - NCR when a shipment is rejected / a CoA is missing                          → ncrWhen
 *   - FEFO engine: balances per batch, issue the earliest expiry, never expired   → stock / stockBatchOf
 *   - readings every 2 hours, alert after 2 h 30 without one                      → maxGapMinutes
 * Shipment / record ids and the receiving date-time are the record id and its server timestamp.
 *
 * `revision` is bumped whenever a built-in definition changes: the library entry (and every company
 * copy that follows it) is upgraded on the next deployment, unless the platform administrator has
 * edited that form since — those edits always win.
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
  maxGapMinutes?: number;
  isDefault: boolean;
  revision?: number;
  fields: FormField[];
}

const STATUS_LABELS = { Compliant: 'مطابق', 'Non-Compliant': 'غير مطابق' };
const EXPIRY_LABELS = { Safe: 'آمن', 'Expiring Soon': 'قارب على الانتهاء (7 أيام أو أقل)', Expired: 'منتهي الصلاحية' };

const CHILLED = 'مبرد (2–8°م)';
const FROZEN = 'مجمد (≤ -18°م)';
const AMBIENT = 'جاف / حرارة الغرفة';

const ZONE_CHILLED = 'مستودع تبريد (2–8°م)';
const ZONE_FROZEN = 'مستودع تجميد (≤ -18°م)';
const ZONE_DRY = 'مستودع جاف (≤ 25°م)';
const ZONE_PHARMA = 'غرفة الأدوية والمواد الحساسة (2–8°م)';

const itemCode = (labelAr = 'كود الصنف'): FormField => ({
  key: 'item_code', labelAr, labelEn: 'Item code', type: 'text', required: true, itemRef: true,
  hint: 'من جدول الأصناف الرئيسي (Item Master)',
});

export const prdForms: CatalogSeed[] = [
  {
    code: 'INBOUND_SHIPMENT', category: 'WMS_GDP', department: 'SUPPORT', ccp: null, isDefault: false, revision: 2,
    titleAr: 'استلام وفحص الإرساليات', titleEn: 'Inbound receiving & inspection',
    description: 'فحص الشاحنات الواردة: حرارة النقل (CCP)، التغليف، وقرار القبول — الرفض يفتح تقرير عدم مطابقة (NCR)',
    fields: [
      { key: 'po_number', labelAr: 'رقم أمر الشراء (ERP)', labelEn: 'PO number', type: 'text', required: true, unique: true,
        pattern: '^[A-Za-z0-9][A-Za-z0-9/-]{2,39}$', patternMessage: 'رقم أمر الشراء: أحرف وأرقام فقط (3–40)',
        hint: 'فريد لكل شحنة ومطابق لنظام ERP' },
      { key: 'supplier_name', labelAr: 'المورد المعتمد', labelEn: 'Approved supplier', type: 'select', options: [], companyOptions: true,
        required: true, hint: 'من قائمة الموردين المؤهلين (Approved Vendor List)' },
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
        ncrWhen: 'Rejected', hint: 'تُرفض إلزامياً عند تجاوز حرارة النقل؛ الرفض يفتح تقرير عدم مطابقة (NCR) تلقائياً' },
    ],
  },
  {
    code: 'BATCH_INSPECTION', category: 'WMS_GDP', department: 'SUPPORT', ccp: null, isDefault: false, revision: 2,
    titleAr: 'فحص وتدقيق الواردات والدفعات', titleEn: 'Batch inspection & CoA',
    description: 'تتبع أرقام التشغيلات وتواريخ الصلاحية وشهادات التحليل (GDP/GMP) — الصنف من جدول الأصناف الرئيسي',
    fields: [
      itemCode('كود الصنف (Item Master)'),
      { key: 'item_name', labelAr: 'اسم الصنف', labelEn: 'Item name', type: 'text', prefill: 'item.name' },
      { key: 'batch_number', labelAr: 'رقم التشغيلة (Lot / Batch)', labelEn: 'Batch number', type: 'text', required: true,
        hint: 'مفهرس للتتبع العكسي وسحب المنتجات (Recall)' },
      { key: 'mfg_date', labelAr: 'تاريخ الإنتاج', labelEn: 'Manufacturing date', type: 'date', required: true },
      { key: 'expiry_date', labelAr: 'تاريخ الانتهاء', labelEn: 'Expiry date', type: 'date', required: true, after: 'mfg_date',
        hint: 'يجب أن يكون بعد تاريخ الإنتاج حصراً، وإلا يُرفض الحفظ' },
      { key: 'coa_verified', labelAr: 'تم التحقق من شهادة التحليل (CoA)', labelEn: 'CoA verified', type: 'boolean',
        required: true, expected: true, critical: true, ncrWhen: false, hint: 'لا تُقبل الشحنة بدون شهادة تحليل؛ يُفتح تقرير عدم مطابقة' },
    ],
  },
  {
    code: 'ENV_MONITORING', category: 'WMS_GDP', department: null, ccp: null, isDefault: false, revision: 2,
    minDailyEntries: 12, maxGapMinutes: 150,
    titleAr: 'المراقبة البيئية — نقاط التحكم الحرجة (كل ساعتين)', titleEn: 'Environmental monitoring (CCP, every 2 h)',
    description: 'رصد الحرارة والرطوبة كل ساعتين؛ تنبيه إداري عند تأخر التسجيل عن ساعتين ونصف، وإنذار فوري لمدير الجودة عند تجاوز الحدود',
    fields: [
      { key: 'zone_location', labelAr: 'المنطقة / المستودع', labelEn: 'Zone location', type: 'text', required: true, prefill: 'equipment.location' },
      { key: 'sensor_id', labelAr: 'كود الحساس / مسجل البيانات', labelEn: 'Sensor / data logger id', type: 'text', required: true,
        prefill: 'equipment.code' },
      { key: 'zone_type', labelAr: 'نوع المنطقة', labelEn: 'Zone type', type: 'select', required: true,
        options: [ZONE_CHILLED, ZONE_FROZEN, ZONE_DRY, ZONE_PHARMA] },
      { key: 'actual_temp', labelAr: 'درجة الحرارة الفعلية', labelEn: 'Actual temperature', type: 'number', unit: '°C',
        required: true, critical: true, validMin: -50, validMax: 70,
        limitsBy: { field: 'zone_type', cases: {
          [ZONE_CHILLED]: { min: 2, max: 8 }, [ZONE_FROZEN]: { max: -18 }, [ZONE_DRY]: { max: 25 }, [ZONE_PHARMA]: { min: 2, max: 8 },
        } } },
      { key: 'humidity', labelAr: 'الرطوبة النسبية', labelEn: 'Relative humidity', type: 'number', unit: '%', required: true,
        validMin: 0, validMax: 100,
        limitsBy: { field: 'zone_type', cases: { [ZONE_DRY]: { max: 60 }, [ZONE_PHARMA]: { max: 60 } } } },
      { key: 'compliance_status', labelAr: 'حالة المطابقة', labelEn: 'Compliance status', type: 'select',
        options: ['Compliant', 'Non-Compliant'], optionLabels: STATUS_LABELS, compute: { kind: 'compliance', fields: ['actual_temp', 'humidity'] } },
    ],
  },
  {
    code: 'INVENTORY_STOCK', category: 'WMS_GDP', department: 'SUPPORT', ccp: null, isDefault: false, revision: 2,
    titleAr: 'مراقبة المخزون والصلاحية (جرد FEFO)', titleEn: 'Inventory stock & expiry (FEFO count)',
    description: 'جرد/إدخال رصيد كل تشغيلة؛ يحدّث محرك FEFO ويحسب الأيام المتبقية وحالة الصلاحية تلقائياً',
    fields: [
      itemCode(),
      { key: 'batch_number', labelAr: 'رقم التشغيلة', labelEn: 'Batch number', type: 'text', required: true },
      { key: 'expiry_date', labelAr: 'تاريخ الانتهاء', labelEn: 'Expiry date', type: 'date', required: true },
      { key: 'current_quantity', labelAr: 'الكمية الحالية', labelEn: 'Current quantity', type: 'number', required: true, validMin: 0,
        stock: { mode: 'count', item: 'item_code', batch: 'batch_number', expiry: 'expiry_date' },
        hint: 'لا تُقبل القيم السالبة؛ يصبح هذا رصيد التشغيلة في محرك FEFO' },
      { key: 'days_remaining', labelAr: 'الأيام المتبقية للصلاحية', labelEn: 'Days remaining', type: 'number', unit: 'يوم',
        compute: { kind: 'daysUntil', field: 'expiry_date' } },
      { key: 'expiry_alert_status', labelAr: 'حالة الصلاحية (FEFO)', labelEn: 'Expiry alert status', type: 'select',
        options: ['Safe', 'Expiring Soon', 'Expired'], optionLabels: EXPIRY_LABELS,
        compute: { kind: 'expiryStatus', field: 'expiry_date', warnDays: 7 } },
    ],
  },
  {
    code: 'STOCK_ISSUE', category: 'WMS_GDP', department: 'SUPPORT', ccp: null, isDefault: false, revision: 1,
    titleAr: 'صرف المخزون (محرك FEFO)', titleEn: 'Stock issue (FEFO engine)',
    description: 'يفرض النظام صرف التشغيلة الأقرب انتهاءً أولاً، ويمنع صرف المنتهي أو أكثر من الرصيد',
    fields: [
      itemCode(),
      { key: 'item_name', labelAr: 'اسم الصنف', labelEn: 'Item name', type: 'text', prefill: 'item.name' },
      { key: 'batch_number', labelAr: 'التشغيلة المصروفة', labelEn: 'Batch issued', type: 'text', required: true, stockBatchOf: 'item_code',
        hint: 'تُعرض التشغيلات بترتيب أقرب انتهاء؛ لا يُقبل غير الأقرب' },
      { key: 'issued_qty', labelAr: 'الكمية المصروفة', labelEn: 'Quantity issued', type: 'number', required: true, validMin: 0.001,
        stock: { mode: 'issue', item: 'item_code', batch: 'batch_number' } },
      { key: 'issued_to', labelAr: 'الجهة المستلمة', labelEn: 'Issued to', type: 'text', required: true, hint: 'القسم / المطبخ / العميل' },
    ],
  },
  {
    code: 'MONTHLY_CONSUMPTION', category: 'WMS_GDP', department: 'SUPPORT', ccp: null, isDefault: false, revision: 2,
    titleAr: 'ملخص الاستهلاك والتدوير الشهري', titleEn: 'Monthly consumption & waste',
    description: 'حركة المخزون الشهرية وإغلاق الفترة ومؤشر الالتزام بسياسة FEFO (المستهدف ≥ 98%)',
    fields: [
      { key: 'period_month', labelAr: 'الشهر', labelEn: 'Period (month)', type: 'month', required: true, unique: true, uniqueWith: ['item_code'],
        hint: 'لا يتكرر نفس الصنف في نفس الشهر' },
      itemCode(),
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
        required: true, validMin: 0, validMax: 100, min: 98, hint: 'المستهدف ≥ 98%' },
    ],
  },
];
