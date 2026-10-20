export type Role = 'ADMIN' | 'HACCP_OFFICER' | 'HSE_OFFICER' | 'KITCHEN_SUPERVISOR' | 'CHEF';
export type Department = 'HOT' | 'COLD' | 'SWEETS' | 'SUPPORT';

export interface User {
  id: string;
  employee_no: string;
  full_name: string;
  email: string;
  role: Role;
  department_code: Department | null;
}

export interface FormField {
  key: string;
  labelAr: string;
  labelEn: string;
  type: 'number' | 'text' | 'boolean' | 'date' | 'select';
  unit?: string;
  required?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  expected?: boolean;
  ccpMeasurement?: boolean;
  limitText?: string;
}

export interface ResolvedForm {
  kind: 'FORM' | 'EQUIPMENT';
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
}

export interface FormTemplateSummary {
  id: string;
  code: string;
  title_ar: string;
  title_en: string;
  department_code: Department | null;
  ccp_id: string | null;
  qr_token: string;
}

export interface Alert {
  id: string;
  source_type: 'CCP_DEVIATION' | 'HEALTH_CERT_EXPIRY' | 'EQUIPMENT_MAINTENANCE';
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
}
