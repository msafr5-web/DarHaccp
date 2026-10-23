import ExcelJS from 'exceljs';
import { DbContext, query, withTransaction } from '../config/database';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { blindIndex, decrypt, encrypt } from '../utils/crypto';
import { loadProcessContext, guessActivity, trackProcess, type ProcessContext, type ProcessStep } from './healthGuide.service';
import { localDate } from './record.service';

/**
 * Health certificates register (Balady) — the establishment's follow-up sheet, column for column:
 * م · اسم المنشأة / الفرع · رقم رخصة بلدي · القسم / النشاط الداخلي · اسم العامل (حسب الهوية) ·
 * رقم الهوية / الإقامة · تاريخ الميلاد · المهنة بالرخصة · رقم الجوال · تاريخ الفحص الطبي · حالة الفحص ·
 * تاريخ انتهاء الشهادة · حالة الشهادة · ملاحظات التنفيذ.
 *
 * "حالة الشهادة" is never typed: it is computed from the exam status and the expiry date, so the sheet
 * can never claim a certificate is valid while the exam result is still pending or the date has passed.
 */

export type ExamStatus = 'FIT' | 'PENDING' | 'UNFIT';
export type CertStatus = 'VALID' | 'EXPIRING' | 'EXPIRED' | 'RENEWAL_REQUIRED' | 'NOT_FIT';

export const EXAM_LABELS: Record<ExamStatus, string> = { FIT: 'سليم (معتمد)', PENDING: 'بانتظار النتيجة', UNFIT: 'غير لائق' };
export const CERT_LABELS: Record<CertStatus, string> = {
  VALID: 'سارية', EXPIRING: 'قريب الانتهاء', EXPIRED: 'منتهية', RENEWAL_REQUIRED: 'تجديد مطلوب', NOT_FIT: 'غير لائق — يُمنع من العمل',
};

const WARN_DAYS = () => env.HEALTH_CERT_WARNING_DAYS;
/** Official renewal window: a certificate can be renewed 60 days before it expires (MOMAH). */
export const RENEWAL_WINDOW_DAYS = 60;
const DAY = 86_400_000;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY);

export function certStatus(exam: ExamStatus, expiry: string | null, today = localDate()): { status: CertStatus; days: number | null } {
  const days = expiry ? dayDiff(expiry, today) : null;
  if (exam === 'UNFIT') return { status: 'NOT_FIT', days };
  if (exam === 'PENDING' || days === null) return { status: 'RENEWAL_REQUIRED', days };
  if (days < 0) return { status: 'EXPIRED', days };
  if (days <= WARN_DAYS()) return { status: 'EXPIRING', days };
  return { status: 'VALID', days };
}

// ---------------------------------------------------------------- normalisation

/** Arabic-Indic (٠–٩) and Persian (۰–۹) digits → 0–9. */
const toLatin = (s: string) => s.replace(/[٠-٩۰-۹]/g, (d) => {
  const c = d.charCodeAt(0);
  return String(c - (c >= 0x06f0 ? 0x06f0 : 0x0660));
});
const clean = (v: unknown) => toLatin(String(v ?? '').replace(/‏|‎/g, '')).trim();

/** Dates as written in Saudi sheets: YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY, DD-MM-YYYY, or an Excel date. */
export function parseDate(v: unknown): string | null | 'INVALID' {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = clean(v);
  if (!s) return null;
  let y: number, m: number, d: number;
  let r = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else return 'INVALID';
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || y < 1900 || y > 2100) return 'INVALID';
  return date.toISOString().slice(0, 10);
}

export function normalizeMobile(v: unknown): string | null | 'INVALID' {
  const digits = clean(v).replace(/[\s\-()+]/g, '');
  if (!digits) return null;
  const local = digits.startsWith('9665') ? `0${digits.slice(3)}` : digits.startsWith('5') && digits.length === 9 ? `0${digits}` : digits;
  return /^05\d{8}$/.test(local) ? local : 'INVALID';
}

export function parseExamStatus(v: unknown): ExamStatus | null | 'INVALID' {
  const s = clean(v).replace(/[\s()]/g, '').toLowerCase();
  if (!s) return null;
  if (/غيرلائق|غيرسليم|unfit|fail/.test(s)) return 'UNFIT';
  if (/سليم|معتمد|لائق|fit|pass/.test(s)) return 'FIT';
  if (/انتظار|بانتظار|pending|قيدالفحص/.test(s)) return 'PENDING';
  return 'INVALID';
}

function parseCertStatus(v: unknown): CertStatus | null {
  const s = clean(v).replace(/\s/g, '');
  if (!s) return null;
  if (/غيرلائق/.test(s)) return 'NOT_FIT';
  if (/منتهي/.test(s)) return 'EXPIRED';
  if (/قريب/.test(s)) return 'EXPIRING';
  if (/تجديد/.test(s)) return 'RENEWAL_REQUIRED';
  if (/سار/.test(s)) return 'VALID';
  return null;
}

// ---------------------------------------------------------------- validation

export interface RegisterInput {
  serial?: number | null;
  branchName: string;
  baladyLicenseNo: string;
  internalSection?: string | null;
  workerName: string;
  idNumber?: string;
  birthDate?: unknown;
  profession?: string | null;
  mobile?: unknown;
  examDate?: unknown;
  examStatus?: unknown;
  certExpiry?: unknown;
  notes?: string | null;
  // Process tracking (issuance steps) — not columns of the Balady sheet.
  city?: string | null;
  activityCode?: string | null;
  requestNo?: string | null;
  eduStatus?: string | null;
  feePaidOn?: unknown;
}

interface Normalized {
  serial: number | null;
  branch_name: string;
  balady_license_no: string;
  internal_section: string | null;
  worker_name: string;
  id_number: string | null;
  birth_date: string | null;
  profession: string | null;
  mobile: string | null;
  exam_date: string | null;
  exam_status: ExamStatus;
  cert_expiry: string | null;
  notes: string | null;
  city: string | null;
  activity_code: string | null;
  request_no: string | null;
  edu_status: 'PENDING' | 'PASSED' | 'FAILED';
  fee_paid_on: string | null;
}

/** Field rules shared by the form and the import. Returns refusals (errors) and advisories (warnings). */
export function normalizeEntry(i: RegisterInput, opts: { requireId: boolean; today?: string }) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const today = opts.today ?? localDate();
  const text = (v: unknown, max: number, label: string) => {
    const s = clean(v);
    if (s.length > max) errors.push(`${label} أطول من ${max} حرفاً`);
    return s || null;
  };

  const workerName = text(i.workerName, 150, 'اسم العامل');
  if (!workerName || workerName.length < 3) errors.push('اسم العامل (حسب الهوية) مطلوب');
  const branch = text(i.branchName, 150, 'اسم المنشأة / الفرع');
  if (!branch) errors.push('اسم المنشأة / الفرع مطلوب');
  const license = clean(i.baladyLicenseNo).replace(/\s/g, '');
  if (!/^\d{5,20}$/.test(license)) errors.push(`رقم رخصة بلدي غير صالح "${license}" (أرقام فقط)`);

  const id = clean(i.idNumber).replace(/\s/g, '');
  if (id) {
    if (!/^[12]\d{9}$/.test(id)) errors.push(`رقم الهوية / الإقامة غير صالح "${id}" (10 أرقام تبدأ بـ 1 للمواطن أو 2 للمقيم)`);
  } else if (opts.requireId) errors.push('رقم الهوية / الإقامة مطلوب');

  const birth = parseDate(i.birthDate);
  if (birth === 'INVALID') errors.push(`تاريخ الميلاد غير صالح "${clean(i.birthDate)}"`);
  else if (birth) {
    const age = dayDiff(today, birth) / 365.25;
    if (age < 15 || age > 90) errors.push(`تاريخ الميلاد ${birth} غير منطقي (العمر ${Math.floor(age)} سنة)`);
  }
  const mobile = normalizeMobile(i.mobile);
  if (mobile === 'INVALID') errors.push(`رقم الجوال غير صالح "${clean(i.mobile)}" (05XXXXXXXX)`);

  const exam = parseDate(i.examDate);
  if (exam === 'INVALID') errors.push(`تاريخ الفحص الطبي غير صالح "${clean(i.examDate)}"`);
  else if (exam && exam > today) errors.push(`تاريخ الفحص الطبي ${exam} في المستقبل`);
  const examStatus = parseExamStatus(i.examStatus);
  if (examStatus === 'INVALID') errors.push(`حالة الفحص غير معروفة "${clean(i.examStatus)}" (سليم (معتمد) / بانتظار النتيجة / غير لائق)`);
  const expiry = parseDate(i.certExpiry);
  if (expiry === 'INVALID') errors.push(`تاريخ انتهاء الشهادة غير صالح "${clean(i.certExpiry)}"`);
  else if (expiry && exam && exam !== 'INVALID' && expiry <= exam) errors.push(`تاريخ انتهاء الشهادة ${expiry} يجب أن يكون بعد تاريخ الفحص ${exam}`);

  const requestNo = clean(i.requestNo).replace(/\s/g, '');
  if (requestNo && !/^[0-9A-Za-z-]{3,30}$/.test(requestNo)) errors.push(`رقم الطلب غير صالح "${requestNo}" (أحرف وأرقام، 3–30)`);
  const eduRaw = clean(i.eduStatus).toUpperCase();
  if (eduRaw && !['PENDING', 'PASSED', 'FAILED'].includes(eduRaw)) errors.push(`حالة التثقيف الصحي غير معروفة "${eduRaw}"`);
  const feePaid = parseDate(i.feePaidOn);
  if (feePaid === 'INVALID') errors.push(`تاريخ سداد الرسوم غير صالح "${clean(i.feePaidOn)}"`);
  else if (feePaid && feePaid > today) errors.push(`تاريخ سداد الرسوم ${feePaid} في المستقبل`);

  const status = (examStatus === 'INVALID' ? null : examStatus) ?? 'PENDING';
  if (status === 'FIT' && !expiry) warnings.push('الفحص سليم دون تاريخ انتهاء للشهادة — ستُعدّ «تجديد مطلوب» حتى يُدخل التاريخ');
  if (status === 'PENDING' && expiry && expiry !== 'INVALID') {
    warnings.push('الفحص بانتظار النتيجة: لا تُعدّ الشهادة سارية قبل صدور النتيجة رغم وجود تاريخ انتهاء');
  }

  const value: Normalized = {
    serial: i.serial ?? null,
    branch_name: branch ?? '',
    balady_license_no: license,
    internal_section: text(i.internalSection, 120, 'القسم / النشاط الداخلي'),
    worker_name: workerName ?? '',
    id_number: id || null,
    birth_date: birth === 'INVALID' ? null : birth,
    profession: text(i.profession, 120, 'المهنة بالرخصة'),
    mobile: mobile === 'INVALID' ? null : mobile,
    exam_date: exam === 'INVALID' ? null : exam,
    exam_status: status,
    cert_expiry: expiry === 'INVALID' ? null : expiry,
    notes: text(i.notes, 2000, 'ملاحظات التنفيذ'),
    city: text(i.city, 60, 'المدينة'),
    activity_code: clean(i.activityCode) || null,
    request_no: requestNo || null,
    edu_status: (eduRaw || 'PENDING') as Normalized['edu_status'],
    fee_paid_on: feePaid === 'INVALID' ? null : feePaid,
  };
  return { value, errors, warnings };
}

// ---------------------------------------------------------------- reads

export interface RegisterRow {
  id: string;
  serial: number;
  branch_name: string;
  balady_license_no: string;
  internal_section: string | null;
  worker_name: string;
  id_number_masked: string;
  id_type: 'CITIZEN' | 'RESIDENT';
  birth_date: string | null;
  profession: string | null;
  mobile: string | null;
  exam_date: string | null;
  exam_status: ExamStatus;
  cert_expiry: string | null;
  cert_status: CertStatus;
  days_remaining: number | null;
  notes: string | null;
  updated_at: string;
  // Process tracking and what the guide derives from it.
  city: string | null;
  activity_code: string | null;
  activity_name: string | null;
  activity_guessed: boolean;
  request_no: string | null;
  edu_status: 'PENDING' | 'PASSED' | 'FAILED';
  edu_required: boolean;
  fee_paid_on: string | null;
  /** The official renewal window (60 days before expiry, or already expired) is open. */
  renewal_open: boolean;
  steps: ProcessStep[];
  next_step: ProcessStep | null;
  progress: { done: number; total: number };
}

interface DbRow extends Omit<RegisterRow, 'id_number_masked' | 'cert_status' | 'days_remaining' | 'activity_name' | 'activity_guessed' | 'edu_required'
  | 'renewal_open' | 'steps' | 'next_step' | 'progress'> {
  id_number_last4: string;
  id_number_enc: string;
}

const COLS = `id, serial, branch_name, balady_license_no, internal_section, worker_name, id_number_last4, id_number_enc, id_type,
  to_char(birth_date, 'YYYY-MM-DD') AS birth_date, profession, mobile, to_char(exam_date, 'YYYY-MM-DD') AS exam_date, exam_status,
  to_char(cert_expiry, 'YYYY-MM-DD') AS cert_expiry, notes, updated_at,
  city, activity_code, request_no, edu_status, to_char(fee_paid_on, 'YYYY-MM-DD') AS fee_paid_on`;

function present(r: DbRow, today: string, ctx: ProcessContext): RegisterRow {
  const { id_number_last4, id_number_enc: _enc, ...rest } = r;
  const s = certStatus(r.exam_status, r.cert_expiry, today);
  const guess = r.activity_code ? null : guessActivity(`${r.profession ?? ''} ${r.internal_section ?? ''}`, ctx.activities);
  const activity = ctx.activities.find((a) => a.code === (r.activity_code ?? guess));
  const proc = trackProcess({ ...r, cert_status: s.status }, ctx);
  return {
    ...rest, id_number_masked: `••••••${id_number_last4}`, cert_status: s.status, days_remaining: s.days,
    activity_name: activity?.name_ar ?? null, activity_guessed: !r.activity_code && !!activity, edu_required: proc.eduRequired,
    renewal_open: s.days !== null && s.days <= RENEWAL_WINDOW_DAYS && s.status !== 'NOT_FIT',
    steps: proc.steps, next_step: proc.next, progress: { done: proc.done, total: proc.total },
  };
}

export async function listRegister(f: { search?: string; status?: CertStatus; branch?: string }) {
  const { rows } = await query<DbRow>(
    `SELECT ${COLS} FROM health_register
      WHERE ($1::text IS NULL OR worker_name ILIKE $1 OR profession ILIKE $1 OR internal_section ILIKE $1 OR mobile ILIKE $1
             OR id_number_last4 = $2 OR balady_license_no = $2)
        AND ($3::text IS NULL OR branch_name = $3)
      ORDER BY serial, worker_name`,
    [f.search ? `%${f.search}%` : null, f.search ?? null, f.branch ?? null],
  );
  const today = localDate();
  const ctx = await loadProcessContext();
  return rows.map((r) => present(r, today, ctx)).filter((r) => !f.status || r.cert_status === f.status);
}

export async function revealIdNumber(id: string) {
  const { rows } = await query<{ id_number_enc: string }>('SELECT id_number_enc FROM health_register WHERE id = $1', [id]);
  if (!rows[0]) throw AppError.notFound('Register entry');
  return decrypt(rows[0].id_number_enc);
}

/** One Balady license per branch: the sheet repeats it on every row of the branch. */
async function assertBranchLicense(branch: string, license: string, excludeId?: string) {
  const { rows } = await query<{ balady_license_no: string }>(
    `SELECT DISTINCT balady_license_no FROM health_register WHERE branch_name = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [branch, excludeId ?? null],
  );
  const other = rows.find((r) => r.balady_license_no !== license);
  if (other) throw AppError.conflict(`الفرع «${branch}» مسجل برقم رخصة بلدي ${other.balady_license_no} — لا يمكن استخدام رقم آخر لنفس الفرع`);
}

async function assertActivity(code: string | null) {
  if (!code) return;
  const { rowCount } = await query('SELECT 1 FROM hc_activities WHERE code = $1 AND is_active', [code]);
  if (!rowCount) throw new AppError(422, 'INVALID_ENTRY', `النشاط «${code}» غير موجود في دليل الأنشطة المستهدفة`);
}

const duplicateId = (err: unknown): never => {
  if ((err as { code?: string }).code === '23505') throw AppError.conflict('رقم الهوية / الإقامة مسجّل مسبقاً في السجل');
  throw err;
};

export async function createEntry(ctx: DbContext, input: RegisterInput) {
  const { value: v, errors, warnings } = normalizeEntry(input, { requireId: true });
  if (errors.length) throw new AppError(422, 'INVALID_ENTRY', errors.join(' · '));
  await assertBranchLicense(v.branch_name, v.balady_license_no);
  await assertActivity(v.activity_code);
  const id = await withTransaction(ctx, async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO health_register (serial, branch_name, balady_license_no, internal_section, worker_name, id_number_enc, id_number_hash,
                                    id_number_last4, id_type, birth_date, profession, mobile, exam_date, exam_status, cert_expiry, notes,
                                    city, activity_code, request_no, edu_status, fee_paid_on)
       VALUES (COALESCE($1, (SELECT COALESCE(max(serial), 0) + 1 FROM health_register)), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               $17,$18,$19,$20,$21)
       RETURNING id`,
      [v.serial, v.branch_name, v.balady_license_no, v.internal_section, v.worker_name, encrypt(v.id_number!), blindIndex(v.id_number!),
        v.id_number!.slice(-4), v.id_number!.startsWith('1') ? 'CITIZEN' : 'RESIDENT', v.birth_date, v.profession, v.mobile,
        v.exam_date, v.exam_status, v.cert_expiry, v.notes, v.city, v.activity_code, v.request_no, v.edu_status, v.fee_paid_on],
    );
    return rows[0]!.id;
  }).catch(duplicateId);
  return { entry: await getEntry(id), warnings };
}

export async function getEntry(id: string) {
  const { rows } = await query<DbRow>(`SELECT ${COLS} FROM health_register WHERE id = $1`, [id]);
  if (!rows[0]) throw AppError.notFound('Register entry');
  return present(rows[0], localDate(), await loadProcessContext());
}

/** Full replacement of the row's values (the form sends every column); the ID number is changed only when sent. */
export async function updateEntry(ctx: DbContext, id: string, input: RegisterInput) {
  await getEntry(id);
  const { value: v, errors, warnings } = normalizeEntry(input, { requireId: false });
  if (errors.length) throw new AppError(422, 'INVALID_ENTRY', errors.join(' · '));
  await assertBranchLicense(v.branch_name, v.balady_license_no, id);
  await assertActivity(v.activity_code);
  await withTransaction(ctx, (db) => db.query(
    `UPDATE health_register SET serial = COALESCE($2, serial), branch_name = $3, balady_license_no = $4, internal_section = $5,
            worker_name = $6, birth_date = $7, profession = $8, mobile = $9, exam_date = $10, exam_status = $11, cert_expiry = $12, notes = $13,
            id_number_enc = COALESCE($14, id_number_enc), id_number_hash = COALESCE($15, id_number_hash),
            id_number_last4 = COALESCE($16, id_number_last4), id_type = COALESCE($17, id_type),
            city = $18, activity_code = $19, request_no = $20, edu_status = $21, fee_paid_on = $22
      WHERE id = $1`,
    [id, v.serial, v.branch_name, v.balady_license_no, v.internal_section, v.worker_name, v.birth_date, v.profession, v.mobile,
      v.exam_date, v.exam_status, v.cert_expiry, v.notes,
      v.id_number ? encrypt(v.id_number) : null, v.id_number ? blindIndex(v.id_number) : null, v.id_number ? v.id_number.slice(-4) : null,
      v.id_number ? (v.id_number.startsWith('1') ? 'CITIZEN' : 'RESIDENT') : null,
      v.city, v.activity_code, v.request_no, v.edu_status, v.fee_paid_on],
  )).catch(duplicateId);
  return { entry: await getEntry(id), warnings };
}

export async function deleteEntry(ctx: DbContext, id: string) {
  const r = await withTransaction(ctx, (db) => db.query('DELETE FROM health_register WHERE id = $1', [id]));
  if (!r.rowCount) throw AppError.notFound('Register entry');
}

// ---------------------------------------------------------------- Excel / CSV

const TITLE = 'سجل متابعة الشهادات الصحية والبيانات الوظيفية للمنشأة (منصة بلدي)';
const HEADERS = [
  'م', 'اسم المنشأة / الفرع', 'رقم رخصة بلدي', 'القسم / النشاط الداخلي', 'اسم العامل (حسب الهوية)', 'رقم الهوية / الإقامة',
  'تاريخ الميلاد (يوم/شهر/سنة)', 'المهنة بالرخصة', 'رقم الجوال', 'تاريخ الفحص الطبي', 'حالة الفحص', 'تاريخ انتهاء الشهادة',
  'حالة الشهادة', 'ملاحظات التنفيذ',
];
const WIDTHS = [6, 26, 15, 24, 28, 16, 16, 20, 14, 15, 17, 17, 16, 34];
const STATUS_FILL: Record<CertStatus, string> = {
  VALID: 'FFE7F6EC', EXPIRING: 'FFFFF4E5', EXPIRED: 'FFFDECEA', RENEWAL_REQUIRED: 'FFFFF4E5', NOT_FIT: 'FFFDECEA',
};
const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

/** The sheet as the establishment keeps it (title, then the 14 columns), plus a summary sheet. */
export async function exportRegister(company: string, opts: { template: boolean; fullIds: boolean }): Promise<Buffer> {
  const { rows } = opts.template ? { rows: [] as DbRow[] } : await query<DbRow>(`SELECT ${COLS} FROM health_register ORDER BY serial, worker_name`);
  const today = localDate();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DarHaccp';
  const ws = wb.addWorksheet('السجل', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 3 }] });
  WIDTHS.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  ws.mergeCells(1, 1, 1, HEADERS.length);
  const title = ws.getCell(1, 1);
  title.value = `${TITLE} — ${company}`;
  title.font = { bold: true, size: 14, color: { argb: 'FF0B5D3B' } };
  title.alignment = { horizontal: 'center' };
  ws.mergeCells(2, 1, 2, HEADERS.length);
  ws.getCell(2, 1).value = `تاريخ الاستخراج: ${dmy(today)} — حالة الشهادة محسوبة آلياً (قريب الانتهاء: ${WARN_DAYS()} يوماً أو أقل)`;
  ws.getCell(2, 1).font = { size: 10, color: { argb: 'FF667085' } };

  const head = ws.getRow(3);
  head.values = HEADERS;
  head.height = 32;
  head.eachCell((c, n) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: n === 13 ? 'FF667085' : 'FF0B5D3B' } };
  });

  const data = opts.template
    ? [[1, 'الفرع الرئيسي', '7000000000', 'المطبخ', 'اسم العامل كما في الهوية (مثال — احذف السطر)', '1000000000', '01/01/1990', 'طباخ',
        '0500000000', '', EXAM_LABELS.PENDING, '', '', '']]
    : rows.map((r) => {
        const s = certStatus(r.exam_status, r.cert_expiry, today);
        return [r.serial, r.branch_name, r.balady_license_no, r.internal_section ?? '', r.worker_name,
          opts.fullIds ? decrypt(r.id_number_enc) : `••••••${r.id_number_last4}`, dmy(r.birth_date), r.profession ?? '', r.mobile ?? '',
          dmy(r.exam_date), EXAM_LABELS[r.exam_status], dmy(r.cert_expiry), CERT_LABELS[s.status], r.notes ?? ''];
      });
  data.forEach((values, i) => {
    const row = ws.addRow(values);
    row.alignment = { vertical: 'middle', wrapText: true };
    for (const c of [3, 6, 9]) row.getCell(c).numFmt = '@';
    if (!opts.template) {
      const status = certStatus(rows[i]!.exam_status, rows[i]!.cert_expiry, today).status;
      row.getCell(13).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATUS_FILL[status] } };
      row.getCell(13).font = { bold: true };
    }
  });
  const last = Math.max(ws.rowCount, 300);
  for (let r = 4; r <= last; r++) {
    ws.getCell(r, 11).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${Object.values(EXAM_LABELS).join(',')}"`] };
  }
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: HEADERS.length } };

  if (!opts.template) {
    const sum = wb.addWorksheet('ملخص', { views: [{ rightToLeft: true }] });
    sum.getColumn(1).width = 34;
    sum.getColumn(2).width = 14;
    sum.addRow([`ملخص السجل — ${company}`]).font = { bold: true, size: 13, color: { argb: 'FF0B5D3B' } };
    sum.addRow(['إجمالي العاملين', rows.length]);
    for (const s of Object.keys(CERT_LABELS) as CertStatus[]) {
      sum.addRow([CERT_LABELS[s], rows.filter((r) => certStatus(r.exam_status, r.cert_expiry, today).status === s).length]);
    }
    sum.addRow([]);
    sum.addRow(['حسب الفرع', 'العدد']).font = { bold: true };
    const branches = new Map<string, number>();
    rows.forEach((r) => branches.set(r.branch_name, (branches.get(r.branch_name) ?? 0) + 1));
    branches.forEach((n, b) => sum.addRow([b, n]));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** CSV as exported by Excel in Arabic locales: UTF-8 (with or without BOM) or Windows-1256, `;` or `,` separated. */
function parseCsv(buf: Buffer): string[][] {
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) text = new TextDecoder('windows-1256').decode(buf);
  text = text.replace(/^﻿/, '');
  const firstLines = text.split(/\r?\n/).slice(0, 5).join('\n');
  const sep = [';', ',', '\t'].sort((a, b) => firstLines.split(b).length - firstLines.split(a).length)[0]!;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function readSheet(file: Buffer): Promise<unknown[][]> {
  const isZip = file[0] === 0x50 && file[1] === 0x4b; // .xlsx is a zip archive
  if (!isZip) return parseCsv(file);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file as unknown as ArrayBuffer);
  } catch {
    throw AppError.unprocessable('تعذر قراءة الملف — ارفع ملف Excel (‎.xlsx) أو CSV');
  }
  const ws = wb.getWorksheet('السجل') ?? wb.worksheets[0];
  if (!ws) throw AppError.unprocessable('الملف لا يحتوي على أوراق');
  const out: unknown[][] = [];
  ws.eachRow({ includeEmpty: true }, (r, n) => {
    const vals: unknown[] = [];
    for (let c = 1; c <= Math.max(ws.columnCount, HEADERS.length); c++) {
      const cell = r.getCell(c);
      vals.push(cell.value instanceof Date ? cell.value : cell.text);
    }
    out[n - 1] = vals;
  });
  return out.map((r) => r ?? []);
}

const norm = (s: unknown) => clean(s).replace(/[\s*()/\\]/g, '');
type Key = 'serial' | 'branch' | 'license' | 'section' | 'name' | 'id' | 'birth' | 'profession' | 'mobile' | 'exam' | 'examStatus' | 'expiry' | 'certStatus' | 'notes';
const MATCHERS: [Key, (h: string) => boolean][] = [
  ['serial', (h) => h === 'م' || h === '#' || h === 'مسلسل'],
  ['name', (h) => h.includes('اسمالعامل') || h.includes('اسمالموظف')],
  ['branch', (h) => h.includes('المنشأة') || h.includes('المنشاة') || h === 'الفرع'],
  ['license', (h) => h.includes('رخصة')],
  ['section', (h) => h.includes('القسم') || h.includes('النشاط')],
  ['id', (h) => h.includes('الهوية') || h.includes('الإقامة') || h.includes('الاقامة')],
  ['birth', (h) => h.includes('الميلاد')],
  ['profession', (h) => h.includes('المهنة')],
  ['mobile', (h) => h.includes('الجوال') || h.includes('الهاتف')],
  ['examStatus', (h) => h.includes('حالةالفحص')],
  ['exam', (h) => h.includes('تاريخالفحص')],
  ['certStatus', (h) => h.includes('حالةالشهادة')],
  ['expiry', (h) => h.includes('انتهاء')],
  ['notes', (h) => h.includes('ملاحظات')],
];

export interface RegisterImportResult {
  total: number;
  create: number;
  update: number;
  unchanged: number;
  skipped: number;
  errors: { row: number; message: string }[];
  warnings: { row: number; message: string }[];
  changes: { row: number; worker_name: string; action: 'create' | 'update'; cert_status: string }[];
  applied: boolean;
}

/**
 * Imports the Balady sheet (the establishment's own CSV / Excel, or this system's export).
 * Rows are matched on the ID / iqama number (encrypted, compared by blind index). Template rows without
 * a worker are skipped. A stated "حالة الشهادة" that contradicts the computed one is reported as a warning.
 * Preview first; applying is all-or-nothing.
 */
export async function importRegister(ctx: DbContext, file: Buffer, apply: boolean): Promise<RegisterImportResult> {
  const sheet = await readSheet(file);
  const headerIdx = sheet.findIndex((r) => r.some((c) => norm(c).includes('اسمالعامل')));
  if (headerIdx < 0) throw AppError.unprocessable('لم يُعثر على صف العناوين (عمود «اسم العامل») — استخدم ملف السجل أو القالب');
  const col: Partial<Record<Key, number>> = {};
  sheet[headerIdx]!.forEach((c, n) => {
    const h = norm(c);
    const hit = MATCHERS.find(([k, m]) => col[k] === undefined && m(h));
    if (hit) col[hit[0]] = n;
  });
  const required: [Key, string][] = [['name', HEADERS[4]!], ['id', HEADERS[5]!], ['branch', HEADERS[1]!], ['license', HEADERS[2]!]];
  for (const [k, label] of required) {
    if (col[k] === undefined) throw AppError.unprocessable(`عمود «${label}» غير موجود في الملف`);
  }

  const { rows: existing } = await query<{ id: string; id_number_hash: string; serial: number; branch_name: string; balady_license_no: string;
    worker_name: string; internal_section: string | null; birth_date: string | null; profession: string | null; mobile: string | null;
    exam_date: string | null; exam_status: ExamStatus; cert_expiry: string | null; notes: string | null }>(
    `SELECT id, id_number_hash, serial, branch_name, balady_license_no, worker_name, internal_section, to_char(birth_date, 'YYYY-MM-DD') AS birth_date,
            profession, mobile, to_char(exam_date, 'YYYY-MM-DD') AS exam_date, exam_status, to_char(cert_expiry, 'YYYY-MM-DD') AS cert_expiry, notes
       FROM health_register`,
  );
  const byHash = new Map(existing.map((e) => [e.id_number_hash, e]));
  const licenses = new Map<string, string>();
  existing.forEach((e) => licenses.set(e.branch_name, e.balady_license_no));

  const today = localDate();
  const result: RegisterImportResult = { total: 0, create: 0, update: 0, unchanged: 0, skipped: 0, errors: [], warnings: [], changes: [], applied: false };
  const planned: { row: number; v: Normalized; existingId?: string; hash: string }[] = [];
  const seen = new Map<string, number>();
  const get = (r: unknown[], k: Key) => (col[k] === undefined ? '' : r[col[k]!]);

  for (let i = headerIdx + 1; i < sheet.length; i++) {
    const r = sheet[i]!;
    const rowNo = i + 1;
    if (!clean(get(r, 'name')) && !clean(get(r, 'id'))) {
      if (r.some((c) => clean(c))) result.skipped++; // template line (serial + branch only)
      continue;
    }
    result.total++;
    if (result.total > 2000) { result.errors.push({ row: rowNo, message: 'تجاوز الحد الأقصى (2000 عامل في الملف)' }); break; }
    const serialRaw = clean(get(r, 'serial'));
    const { value: v, errors, warnings } = normalizeEntry({
      serial: /^\d{1,6}$/.test(serialRaw) ? Number(serialRaw) : null,
      branchName: String(get(r, 'branch') ?? ''), baladyLicenseNo: String(get(r, 'license') ?? ''), internalSection: String(get(r, 'section') ?? ''),
      workerName: String(get(r, 'name') ?? ''), idNumber: String(get(r, 'id') ?? ''), birthDate: get(r, 'birth'), profession: String(get(r, 'profession') ?? ''),
      mobile: get(r, 'mobile'), examDate: get(r, 'exam'), examStatus: get(r, 'examStatus'), certExpiry: get(r, 'expiry'), notes: String(get(r, 'notes') ?? ''),
    }, { requireId: true, today });
    if (v.id_number) {
      if (seen.has(v.id_number)) errors.push(`رقم الهوية مكرر في الملف (الصف ${seen.get(v.id_number)})`);
      seen.set(v.id_number, rowNo);
    }
    if (v.branch_name && v.balady_license_no) {
      const known = licenses.get(v.branch_name);
      if (known && known !== v.balady_license_no) errors.push(`الفرع «${v.branch_name}» برقم رخصة ${known} — والملف يذكر ${v.balady_license_no}`);
      else licenses.set(v.branch_name, v.balady_license_no);
    }
    const name = v.worker_name || '—';
    if (errors.length) { result.errors.push({ row: rowNo, message: `${name}: ${errors.join('، ')}` }); continue; }
    warnings.forEach((w) => result.warnings.push({ row: rowNo, message: `${name}: ${w}` }));

    const computed = certStatus(v.exam_status, v.cert_expiry, today).status;
    const stated = parseCertStatus(get(r, 'certStatus'));
    if (stated && stated !== computed) {
      result.warnings.push({ row: rowNo, message: `${name}: حالة الشهادة في الملف «${clean(get(r, 'certStatus'))}» والمحسوبة «${CERT_LABELS[computed]}» — تُعتمد المحسوبة` });
    }

    const hash = blindIndex(v.id_number!);
    const old = byHash.get(hash);
    if (old) {
      const same = old.branch_name === v.branch_name && old.balady_license_no === v.balady_license_no && old.worker_name === v.worker_name
        && old.internal_section === v.internal_section && old.birth_date === v.birth_date && old.profession === v.profession
        && old.mobile === v.mobile && old.exam_date === v.exam_date && old.exam_status === v.exam_status && old.cert_expiry === v.cert_expiry
        && old.notes === v.notes && (v.serial === null || v.serial === old.serial);
      if (same) { result.unchanged++; continue; }
      result.update++;
      result.changes.push({ row: rowNo, worker_name: v.worker_name, action: 'update', cert_status: CERT_LABELS[computed] });
    } else {
      result.create++;
      result.changes.push({ row: rowNo, worker_name: v.worker_name, action: 'create', cert_status: CERT_LABELS[computed] });
    }
    planned.push({ row: rowNo, v, existingId: old?.id, hash });
  }

  if (!apply) return result;
  if (result.errors.length) throw AppError.unprocessable(`لا يمكن التطبيق: يوجد ${result.errors.length} خطأ في الملف — صححها ثم أعد الاستيراد`);
  await withTransaction(ctx, async (db) => {
    for (const { v, existingId, hash } of planned) {
      const args = [v.branch_name, v.balady_license_no, v.internal_section, v.worker_name, v.birth_date, v.profession, v.mobile,
        v.exam_date, v.exam_status, v.cert_expiry, v.notes];
      if (existingId) {
        await db.query(
          `UPDATE health_register SET branch_name = $2, balady_license_no = $3, internal_section = $4, worker_name = $5, birth_date = $6,
                  profession = $7, mobile = $8, exam_date = $9, exam_status = $10, cert_expiry = $11, notes = $12, serial = COALESCE($13, serial)
            WHERE id = $1`,
          [existingId, ...args, v.serial],
        );
      } else {
        await db.query(
          `INSERT INTO health_register (branch_name, balady_license_no, internal_section, worker_name, birth_date, profession, mobile,
                                        exam_date, exam_status, cert_expiry, notes, serial, id_number_enc, id_number_hash, id_number_last4, id_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, COALESCE($12, (SELECT COALESCE(max(serial), 0) + 1 FROM health_register)), $13,$14,$15,$16)`,
          [...args, v.serial, encrypt(v.id_number!), hash, v.id_number!.slice(-4), v.id_number!.startsWith('1') ? 'CITIZEN' : 'RESIDENT'],
        );
      }
    }
  });
  return { ...result, applied: true };
}
