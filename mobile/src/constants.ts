import { colors } from './theme';

export const INCIDENT_TYPES = [
  { value: 'NON_CONFORMITY', label: 'عدم مطابقة' },
  { value: 'FOOD_SAFETY_INCIDENT', label: 'حادث سلامة غذاء' },
  { value: 'OHS_INCIDENT', label: 'إصابة / حادث سلامة مهنية' },
  { value: 'CUSTOMER_COMPLAINT', label: 'شكوى عميل' },
  { value: 'NEAR_MISS', label: 'شبه حادث' },
  { value: 'REGULATORY_INSPECTION', label: 'ملاحظة جهة رقابية' },
] as const;

export const SEVERITIES = [
  { value: 'LOW', label: 'منخفضة', color: colors.muted },
  { value: 'MEDIUM', label: 'متوسطة', color: colors.warning },
  { value: 'HIGH', label: 'عالية', color: '#D92D20' },
  { value: 'CRITICAL', label: 'حرجة', color: colors.danger },
] as const;

export const INCIDENT_STATUS = {
  OPEN: { label: 'مفتوح', color: colors.danger },
  UNDER_INVESTIGATION: { label: 'قيد التحقيق', color: colors.warning },
  CLOSED: { label: 'مغلق', color: colors.success },
} as const;

export const incidentTypeLabel = (t: string) =>
  INCIDENT_TYPES.find((x) => x.value === t)?.label ?? (t === 'AUDIT_FINDING' ? 'ملاحظة تدقيق' : t);

export const AUDIT_STANDARDS = [
  { value: 'HACCP_ISO22000', label: 'سلامة الغذاء HACCP / ISO 22000' },
  { value: 'ISO45001_HSE', label: 'السلامة المهنية ISO 45001' },
] as const;

export const LABEL_STATE = {
  FRESH: { label: 'صالح', color: colors.success },
  EXPIRING: { label: 'ينتهي قريباً — استخدم أولاً', color: colors.warning },
  EXPIRED: { label: 'منتهي — يجب الإتلاف', color: colors.danger },
} as const;

export const SERVICE_TYPES: Record<string, string> = {
  PEST_CONTROL: 'مكافحة الآفات',
  MAINTENANCE: 'الصيانة',
  CLEANING: 'النظافة',
  WASTE_DISPOSAL: 'إدارة النفايات',
  TRANSPORT: 'النقل',
  FIRE_SAFETY: 'السلامة من الحريق',
  OTHER: 'أخرى',
};

export const DOCUMENT_CATEGORIES: Record<string, string> = {
  IMS_POLICY: 'سياسة النظام المتكامل',
  HACCP_PLAN: 'خطة الهاسب',
  SOP: 'إجراء تشغيلي قياسي',
  EVACUATION_PLAN: 'خطة الإخلاء',
  FIRE_EXTINGUISHER_LAYOUT: 'مخطط طفايات الحريق',
  EMERGENCY_PLAN: 'خطة الطوارئ',
  LICENSE: 'ترخيص',
  CERTIFICATE: 'شهادة',
  OTHER: 'أخرى',
};
