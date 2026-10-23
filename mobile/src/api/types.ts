export type Role = 'ADMIN' | 'HACCP_OFFICER' | 'HSE_OFFICER' | 'KITCHEN_SUPERVISOR' | 'CHEF' | 'PLATFORM_ADMIN';

export interface TenantSummary {
  id: number;
  account_no: string;
  code: string;
  name: string;
}

export type TenantStatus = 'PENDING_VERIFICATION' | 'PENDING_REVIEW' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED';

export interface TenantDetails extends TenantSummary {
  phone: string;
  email: string;
  address: string;
  subscription_date: string;
  status: TenantStatus;
  email_verified_at: string | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  review_notes: string | null;
  created_at: string;
  users_count: number;
  last_login_at: string | null;
  records_count: number;
}

export interface LoginAttempt {
  id: number;
  tenant_name: string | null;
  tenant_code: string | null;
  company_code: string | null;
  user_name: string | null;
  email: string | null;
  stage: 'EMAIL' | 'MAGIC_LINK' | 'OTP' | 'OTP_RESEND' | 'PASSWORD';
  success: boolean;
  failure_reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  occurred_at: string;
}
export type Department = 'HOT' | 'COLD' | 'SWEETS' | 'SUPPORT';

export interface User {
  id: string;
  employee_no: string;
  full_name: string;
  email: string;
  role: Role;
  department_code: Department | null;
  is_active?: boolean;
  /** FILL = fill forms only; FILL_EDIT = fill and amend records. */
  record_access?: RecordAccess;
  phone?: string | null;
  last_login_at?: string | null;
  tenant?: TenantSummary;
}

export type RecordAccess = 'FILL' | 'FILL_EDIT';

export interface Limits {
  min?: number;
  max?: number;
}

export type FieldCompute =
  | { kind: 'sum'; terms: { field: string; sign: 1 | -1 }[] }
  | { kind: 'daysUntil'; field: string }
  | { kind: 'expiryStatus'; field: string; warnDays: number }
  | { kind: 'compliance'; fields: string[] };

export type FieldType = 'number' | 'text' | 'boolean' | 'date' | 'select' | 'time' | 'month';

export interface FormField {
  key: string;
  labelAr: string;
  labelEn: string;
  type: FieldType;
  hint?: string;
  optionLabels?: Record<string, string>;
  limitsBy?: { field: string; cases: Record<string, Limits> };
  validMin?: number;
  validMax?: number;
  after?: string;
  pattern?: string;
  patternMessage?: string;
  unique?: boolean;
  uniqueWith?: string[];
  carryFrom?: string;
  carryMatch?: string[];
  compute?: FieldCompute;
  prefill?: 'equipment.code' | 'equipment.name' | 'equipment.location' | 'branch.name';
  onCriticalDeviation?: string;
  companyOptions?: boolean;
  unit?: string;
  required?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  expected?: boolean;
  ccpMeasurement?: boolean;
  durationFrom?: string;
  maxMinutes?: number;
  critical?: boolean;
  limitText?: string;
}

export interface ResolvedLabel {
  kind: 'LABEL';
  label: { id: string; label_no: string; product_name: string; batch_no: string; status: string; produced_at: string; expires_at: string; expired: boolean };
}

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Incident {
  id: string;
  incident_no: string;
  type: string;
  severity: Severity;
  department_code: Department;
  title: string;
  description: string;
  location: string | null;
  occurred_at: string;
  status: 'OPEN' | 'UNDER_INVESTIGATION' | 'CLOSED';
  reported_by_name: string;
  assigned_to_name: string | null;
  root_cause: string | null;
  corrective_action: string | null;
  capa_id: string | null;
  capa_no: string | null;
  capa_status: string | null;
  audit_no: string | null;
}

export interface AuditItem {
  id: string;
  clause: string;
  question: string;
  compliant: boolean | null;
  note: string | null;
}

export interface InternalAudit {
  id: string;
  audit_no: string;
  title: string;
  standard: string;
  department_code: Department;
  auditor_name: string;
  scheduled_date: string;
  conducted_at: string | null;
  status: 'PLANNED' | 'COMPLETED';
  score: number | null;
  findings: number;
  open_findings: number;
  items?: AuditItem[];
  summary?: string | null;
}

export interface Recipe {
  id: string;
  code: string;
  name_ar: string;
  department_code: Department;
  ingredients: { name: string }[];
  allergens: string[];
  shelf_life_hours: number;
  storage_temp_max: number | null;
  storage_instructions: string | null;
}

export interface ProductLabel {
  id: string;
  label_no: string;
  product_name: string;
  batch_no: string;
  quantity: number;
  unit: string;
  produced_at: string;
  expires_at: string;
  hours_left: number;
  state: 'FRESH' | 'EXPIRING' | 'EXPIRED';
  status: 'ACTIVE' | 'CONSUMED' | 'DISCARDED';
  status_reason: string | null;
  allergens: string[];
  ingredients: { name: string }[];
  storage_temp_max: number | null;
  department_code: Department;
  produced_by_name: string;
  printUrl?: string;
}

export interface StaffMember {
  id: string;
  employee_no: string;
  full_name: string;
  nationality: string | null;
  id_number_last4: string | null;
  job_title: string | null;
  department_code: Department;
  status: string;
  municipality_cert_no: string | null;
  cert_expiry_date: string | null;
  days_to_expiry: number | null;
  fitness: 'FIT' | 'EXPIRING_SOON' | 'UNFIT';
  last_daily_check: string | null;
}

export interface Contractor {
  id: string;
  name: string;
  service_type: string;
  license_no: string | null;
  license_expiry: string | null;
  contract_end: string | null;
  is_approved: boolean;
  compliance_state: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';
  last_score: number | null;
  last_period: string | null;
  last_recommendation: string | null;
}

export interface ControlledDocument {
  id: string;
  doc_no: string;
  title: string;
  category: string;
  version: string;
  effective_date: string;
  review_date: string | null;
  review_state: 'CURRENT' | 'DUE_SOON' | 'OVERDUE' | 'NO_REVIEW';
  file_url: string | null;
  owner_name: string | null;
}

export interface FillContext {
  company: { name: string; code: string };
  branch: string | null;
  site: string | null;
  deviceNo: string | null;
  employee: { id: string; name: string; employeeNo: string; role: Role; department: Department | null };
  access: RecordAccess;
  serverTime: string;
}

export interface ResolvedForm {
  kind: 'FORM' | 'EQUIPMENT';
  context?: FillContext;
  prefill?: Record<string, unknown>;
  minDailyEntries?: number;
  department: Department | null;
  template: { id: string; code: string; titleAr: string; titleEn: string; description: string | null; version: number; fields: FormField[] };
  ccp: { code: string; nameAr: string; hazard: string; criticalLimit: string; correctiveAction: string } | null;
  equipment: { id: string; code: string; name: string; location: string | null; status: string } | null;
}

export interface Deviation {
  field: string;
  label: string;
  value: unknown;
  limit: string;
  message: string;
  critical: boolean;
}

export interface MonitoringRecord {
  id: string;
  template_title_ar: string;
  ccp_code: string | null;
  department_code: Department;
  equipment_code: string | null;
  recorded_by_name: string;
  measured_value: number | null;
  unit: string | null;
  status: 'PASS' | 'FAIL';
  deviations: Deviation[];
  product_name: string | null;
  recorded_at: string;
  capa_id: string | null;
  template_id: string;
  template_code: string;
  data: Record<string, unknown>;
  notes: string | null;
  corrective_action_taken: string | null;
  source: 'QR' | 'MANUAL' | 'IOT';
  recorded_by: string;
  company_name: string;
  branch_name: string | null;
  equipment_name: string | null;
  equipment_location: string | null;
  recorded_by_employee_no: string;
  recorded_by_role: Role;
  device_info: string | null;
  template_version: number;
  revision: number;
  amended_at: string | null;
  amended_by_name: string | null;
  amendment_reason: string | null;
  template_fields?: FormField[];
  template_current_version?: number;
}

export interface RecordRevision {
  revision: number;
  data: Record<string, unknown>;
  status: 'PASS' | 'FAIL';
  deviations: Deviation[];
  authored_at: string;
  authored_by_name: string;
  superseded_at: string;
  superseded_by_name: string;
  reason: string;
}

export interface FormTemplateSummary {
  id: string;
  code: string;
  title_ar: string;
  title_en: string;
  department_code: Department | null;
  ccp_id: string | null;
  qr_token: string;
  fields: FormField[];
  version: number;
  catalog_id: string | null;
  min_daily_entries: number;
}

/** Platform form library. */
export interface CatalogForm {
  id: string;
  code: string;
  title_ar: string;
  title_en: string;
  description: string | null;
  category: string;
  department_code: Department | null;
  ccp_code: string | null;
  fields: FormField[];
  min_daily_entries: number;
  version: number;
  is_default: boolean;
  is_active: boolean;
  companies_count?: number;
  propagated_to?: number;
}

/** A library form as enabled (or not) for one company. */
export interface TenantForm {
  catalog_id: string;
  code: string;
  title_ar: string;
  title_en: string;
  category: string;
  catalog_version: number;
  catalog_active: boolean;
  is_default: boolean;
  template_id: string | null;
  enabled: boolean;
  customized: boolean;
  version: number | null;
  synced_version: number | null;
  records_count: number;
}

export interface Alert {
  id: string;
  source_type: 'CCP_DEVIATION' | 'HEALTH_CERT_EXPIRY' | 'EQUIPMENT_MAINTENANCE' | 'MISSED_MONITORING' | string;
  department_code: Department | null;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  title: string;
  message: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  created_at: string;
}

export interface Capa {
  id: string;
  capa_no: string;
  ccp_code: string | null;
  department_code: Department;
  description: string;
  immediate_action: string | null;
  root_cause: string | null;
  corrective_action: string | null;
  preventive_action: string | null;
  product_disposition: string | null;
  assigned_to_name: string | null;
  due_date: string | null;
  status: 'OPEN' | 'IN_PROGRESS' | 'CLOSED' | 'VERIFIED';
  closed_by: string | null;
  verification_notes: string | null;
  created_at: string;
}

export interface Overview {
  compliance: {
    total: number;
    passed: number;
    failed: number;
    complianceRate: number | null;
    byDepartment: { code: Department; name_ar: string; total: number; passed: number; failed: number; complianceRate: number | null }[];
  };
  deviationsToday: number;
  openAlerts: { total: number; bySeverity: Record<string, number> };
  capas: { open: number; in_progress: number; overdue: number; closed_awaiting_verification: number };
  healthCertificates: { total: number; valid: number; expiring_soon: number; expired: number; warningDays: number };
  equipment: { total: number; operational: number; under_maintenance: number; out_of_service: number; maintenance_overdue: number; maintenance_due_7d: number };
  quality: { open_incidents: number; open_food_safety: number; audits_30d: number; avg_audit_score: number | null; planned_audits: number };
  labels: { active: number; expiring_12h: number; expired_not_discarded: number };
  staff: { food_handlers: number; fit: number; expiring_soon: number; unfit: number };
  hse: { contractors_expiring: number; documents_due_review: number };
}

export type EquipmentStatus = 'OPERATIONAL' | 'UNDER_MAINTENANCE' | 'OUT_OF_SERVICE';

/** Equipment / data logger with its QR code and linked monitoring form. */
export interface Equipment {
  id: string;
  code: string;
  name: string;
  type: string;
  department_code: Department;
  location: string | null;
  status: EquipmentStatus;
  form_template_id: string | null;
  qr_token: string;
  maintenance_interval_days: number;
  last_maintenance_date: string | null;
  next_maintenance_date: string | null;
  days_to_maintenance: number | null;
  form_code: string | null;
  form_title_ar: string | null;
  min_daily_entries: number;
  readings_today: number;
  last_reading_at: string | null;
  has_device_key: boolean;
  created_at: string;
}

export interface MaintenanceLog {
  id: string;
  type: 'PREVENTIVE' | 'CORRECTIVE' | 'CALIBRATION';
  description: string;
  vendor: string | null;
  performed_at: string;
  next_due_date: string | null;
  performed_by_name: string;
}

export interface QrLabel {
  id: string;
  title: string;
  subtitle: string;
  location: string | null;
  company: string;
  payload: string;
  dataUrl: string;
}
