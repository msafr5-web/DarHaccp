import ExcelJS from 'exceljs';
import { DbContext, query, withTransaction } from '../config/database';
import { AppError } from '../utils/AppError';

/**
 * Item master ⇄ Excel: export (with dropdown validation), blank template, and bulk import.
 * Import is two-step: a dry run returns what would be created / updated and every row error;
 * applying is all-or-nothing (no partial imports) and never deletes items — deactivate with the
 * status column instead. The item code is the key and is never renamed.
 */

type Storage = 'CHILLED' | 'FROZEN' | 'AMBIENT' | 'SENSITIVE';

export const STORAGE_LABELS: Record<Storage, string> = {
  CHILLED: 'مبرد 2–8°م',
  FROZEN: 'مجمد ≤ -18°م',
  AMBIENT: 'جاف / حرارة الغرفة',
  SENSITIVE: 'حساس (أدوية 2–8°م)',
};
const ACTIVE = 'نشط';
const INACTIVE = 'موقوف';
const CODE_RE = /^[A-Z0-9][A-Z0-9._/-]{0,39}$/;
export const MAX_IMPORT_ROWS = 5000;

const COLUMNS = [
  { key: 'code', header: 'كود الصنف *', width: 18 },
  { key: 'name_ar', header: 'الاسم بالعربية *', width: 34 },
  { key: 'name_en', header: 'الاسم بالإنجليزية', width: 28 },
  { key: 'category', header: 'الفئة', width: 18 },
  { key: 'storage', header: 'شرط التخزين *', width: 22 },
  { key: 'unit', header: 'الوحدة', width: 12 },
  { key: 'status', header: 'الحالة', width: 12 },
  { key: 'stock', header: 'الرصيد الحالي (للعرض)', width: 20 },
  { key: 'batches', header: 'عدد التشغيلات (للعرض)', width: 20 },
] as const;

interface ItemRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  category: string | null;
  storage_condition: Storage;
  unit: string;
  is_active: boolean;
  stock_quantity: number;
  batches_count: number;
}

async function loadItems() {
  const { rows } = await query<ItemRow>(
    `SELECT i.id, i.code, i.name_ar, i.name_en, i.category, i.storage_condition, i.unit, i.is_active,
            COALESCE((SELECT SUM(b.quantity) FROM stock_batches b WHERE UPPER(b.item_code) = UPPER(i.code)), 0)::float AS stock_quantity,
            (SELECT COUNT(*)::int FROM stock_batches b WHERE UPPER(b.item_code) = UPPER(i.code) AND b.quantity > 0) AS batches_count
       FROM items i ORDER BY i.code`,
  );
  return rows;
}

/** Workbook of the company's items (or an empty template), right-to-left with dropdowns. */
export async function exportItems(company: string, template: boolean): Promise<Buffer> {
  const items = template ? [] : await loadItems();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DarHaccp';
  wb.created = new Date();

  const ws = wb.addWorksheet('الأصناف', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS.map((c) => ({ key: c.key, header: c.header, width: c.width }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  head.height = 30;
  head.eachCell((cell, col) => {
    const readOnly = col > 7;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: readOnly ? 'FF667085' : 'FF0B5D3B' } };
  });

  const rows = template
    ? [{ code: 'ITM-1001', name_ar: 'أرز بسمتي (مثال — احذف هذا السطر)', name_en: 'Basmati rice', category: 'حبوب', storage: STORAGE_LABELS.AMBIENT, unit: 'كغ', status: ACTIVE }]
    : items.map((i) => ({
        code: i.code, name_ar: i.name_ar, name_en: i.name_en ?? '', category: i.category ?? '', storage: STORAGE_LABELS[i.storage_condition],
        unit: i.unit, status: i.is_active ? ACTIVE : INACTIVE, stock: i.stock_quantity, batches: i.batches_count,
      }));
  rows.forEach((r) => ws.addRow(r));

  const last = Math.max(rows.length + 1, 500);
  const storageList = `"${Object.values(STORAGE_LABELS).join(',')}"`;
  for (let r = 2; r <= last; r++) {
    ws.getCell(`E${r}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: [storageList], showErrorMessage: true,
      errorTitle: 'شرط التخزين', error: 'اختر من القائمة',
    };
    ws.getCell(`G${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${ACTIVE},${INACTIVE}"`] };
    for (const c of ['H', 'I']) ws.getCell(`${c}${r}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F4F7' } };
  }
  ws.autoFilter = { from: 'A1', to: 'G1' };

  const help = wb.addWorksheet('تعليمات', { views: [{ rightToLeft: true }] });
  help.getColumn(1).width = 110;
  [
    `جدول الأصناف الرئيسي — ${company}`,
    '',
    '• كود الصنف هو المفتاح: أحرف إنجليزية وأرقام و . _ / - (حتى 40 حرفاً). لا يمكن تغيير كود صنف موجود.',
    '• إذا كان الكود موجوداً يُحدَّث الصنف، وإذا كان جديداً يُضاف.',
    '• الاسم بالعربية وشرط التخزين إلزاميان للأصناف الجديدة.',
    `• شرط التخزين: ${Object.values(STORAGE_LABELS).join(' / ')}`,
    `• الحالة: ${ACTIVE} أو ${INACTIVE} — لا تُحذف الأصناف، بل توقف (لأن السجلات والتشغيلات مرتبطة بها).`,
    '• العمودان الرماديان (الرصيد وعدد التشغيلات) للعرض فقط ويُتجاهلان عند الاستيراد.',
    '• الخلايا الفارغة في صنف موجود تُبقي القيمة الحالية كما هي.',
    `• الحد الأقصى ${MAX_IMPORT_ROWS} صنف في الملف. يُعرض ملخص التغييرات والأخطاء قبل التطبيق، ولا يُطبَّق شيء إذا وُجد خطأ.`,
  ].forEach((line, i) => {
    const row = help.addRow([line]);
    if (i === 0) row.font = { bold: true, size: 14, color: { argb: 'FF0B5D3B' } };
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------- import

const norm = (s: string) => s.replace(/[\s*()]/g, '').toLowerCase();
const HEADER_MATCH: Record<string, string[]> = {
  code: ['كودالصنف', 'الكود', 'code', 'itemcode'],
  name_ar: ['الاسمبالعربية', 'الاسم', 'namear', 'arabicname', 'name'],
  name_en: ['الاسمبالإنجليزية', 'الاسمبالانجليزية', 'nameen', 'englishname'],
  category: ['الفئة', 'category'],
  storage: ['شرطالتخزين', 'التخزين', 'storage', 'storagecondition'],
  unit: ['الوحدة', 'unit'],
  status: ['الحالة', 'status', 'active'],
};

function parseStorage(v: string): Storage | null {
  const s = norm(v);
  for (const [k, label] of Object.entries(STORAGE_LABELS) as [Storage, string][]) {
    if (s === k.toLowerCase() || s === norm(label)) return k;
  }
  if (/مبرد|chill/.test(s)) return 'CHILLED';
  if (/مجمد|frozen|freez/.test(s)) return 'FROZEN';
  if (/حساس|دواء|أدوية|sensitive|pharma/.test(s)) return 'SENSITIVE';
  if (/جاف|الغرفة|ambient|dry/.test(s)) return 'AMBIENT';
  return null;
}

function parseStatus(v: string): boolean | null {
  const s = norm(v);
  if (['نشط', 'فعال', 'مفعل', 'active', 'true', 'yes', '1', 'نعم'].includes(s)) return true;
  if (['موقوف', 'متوقف', 'غيرنشط', 'inactive', 'false', 'no', '0', 'لا'].includes(s)) return false;
  return null;
}

export interface ImportChange {
  row: number;
  code: string;
  action: 'create' | 'update' | 'unchanged';
  name_ar: string;
  changes: string[];
}

export interface ImportResult {
  total: number;
  create: number;
  update: number;
  unchanged: number;
  errors: { row: number; message: string }[];
  changes: ImportChange[];
  applied: boolean;
}

interface Planned {
  row: number;
  existing?: ItemRow;
  code: string;
  name_ar: string;
  name_en: string | null;
  category: string | null;
  storage: Storage;
  unit: string;
  active: boolean;
  changes: string[];
}

const FIELD_LABELS: Record<string, string> = {
  name_ar: 'الاسم', name_en: 'الاسم الإنجليزي', category: 'الفئة', storage: 'شرط التخزين', unit: 'الوحدة', active: 'الحالة',
};

/** Validates the workbook against the item master; with `apply`, writes everything in one transaction. */
export async function importItems(ctx: DbContext, file: Buffer, apply: boolean): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file as unknown as ArrayBuffer);
  } catch {
    throw AppError.unprocessable('تعذر قراءة الملف — يجب أن يكون ملف Excel بصيغة ‎.xlsx');
  }
  const ws = wb.worksheets.find((w) => w.name === 'الأصناف') ?? wb.worksheets[0];
  if (!ws) throw AppError.unprocessable('الملف لا يحتوي على أوراق');

  // Columns are found by their header text, so the order of columns does not matter.
  const col: Record<string, number> = {};
  ws.getRow(1).eachCell((cell, n) => {
    const h = norm(cell.text ?? '');
    for (const [key, names] of Object.entries(HEADER_MATCH)) {
      if (col[key] === undefined && names.some((x) => h === x || (x.length > 4 && h.startsWith(x)))) col[key] = n;
    }
  });
  if (!col.code) throw AppError.unprocessable('لم يُعثر على عمود «كود الصنف» في الصف الأول — استخدم قالب التصدير');
  if (!col.name_ar) throw AppError.unprocessable('لم يُعثر على عمود «الاسم بالعربية» في الصف الأول');

  const existing = new Map((await loadItems()).map((i) => [i.code.toUpperCase(), i]));
  const errors: ImportResult['errors'] = [];
  const planned: Planned[] = [];
  const seen = new Map<string, number>();
  const text = (r: ExcelJS.Row, key: string) => (col[key] ? String(r.getCell(col[key]!).text ?? '').trim() : '');

  for (let n = 2; n <= ws.rowCount; n++) {
    const r = ws.getRow(n);
    const code = text(r, 'code').toUpperCase();
    const nameAr = text(r, 'name_ar');
    if (!code && !nameAr && !text(r, 'name_en') && !text(r, 'category')) continue; // empty line
    if (planned.length + errors.length >= MAX_IMPORT_ROWS) {
      errors.push({ row: n, message: `تجاوز الحد الأقصى (${MAX_IMPORT_ROWS} صنف)` });
      break;
    }
    const rowErrors: string[] = [];
    if (!CODE_RE.test(code)) rowErrors.push(code ? `كود غير صالح "${code}" (أحرف إنجليزية وأرقام و . _ / - حتى 40)` : 'كود الصنف مطلوب');
    if (seen.has(code)) rowErrors.push(`الكود ${code} مكرر في الملف (الصف ${seen.get(code)})`);
    const old = existing.get(code);

    const storageText = text(r, 'storage');
    const storage = storageText ? parseStorage(storageText) : old?.storage_condition ?? null;
    if (!storage) rowErrors.push(storageText ? `شرط تخزين غير معروف "${storageText}"` : 'شرط التخزين مطلوب للصنف الجديد');
    const statusText = text(r, 'status');
    const active = statusText ? parseStatus(statusText) : old?.is_active ?? true;
    if (active === null) rowErrors.push(`حالة غير معروفة "${statusText}" (${ACTIVE} / ${INACTIVE})`);
    const name = nameAr || old?.name_ar || '';
    if (name.length < 2 || name.length > 150) rowErrors.push('الاسم بالعربية مطلوب (2–150 حرفاً)');
    const unit = text(r, 'unit') || old?.unit || 'وحدة';
    if (unit.length > 20) rowErrors.push('الوحدة أطول من 20 حرفاً');
    const nameEn = col.name_en ? text(r, 'name_en') || old?.name_en || null : old?.name_en ?? null;
    if (nameEn && nameEn.length > 150) rowErrors.push('الاسم الإنجليزي أطول من 150 حرفاً');
    const category = col.category ? text(r, 'category') || old?.category || null : old?.category ?? null;
    if (category && category.length > 60) rowErrors.push('الفئة أطول من 60 حرفاً');

    if (code) seen.set(code, n);
    if (rowErrors.length) {
      errors.push({ row: n, message: `${code || '—'}: ${rowErrors.join('، ')}` });
      continue;
    }
    const p: Planned = { row: n, existing: old, code: old?.code ?? code, name_ar: name, name_en: nameEn, category, storage: storage!, unit, active: active!, changes: [] };
    if (old) {
      const diff: [string, unknown, unknown][] = [
        ['name_ar', old.name_ar, p.name_ar], ['name_en', old.name_en, p.name_en], ['category', old.category, p.category],
        ['storage', old.storage_condition, p.storage], ['unit', old.unit, p.unit], ['active', old.is_active, p.active],
      ];
      p.changes = diff.filter(([, a, b]) => (a ?? null) !== (b ?? null)).map(([k]) => FIELD_LABELS[k]!);
    }
    planned.push(p);
  }

  const changes: ImportChange[] = planned.map((p) => ({
    row: p.row, code: p.code, name_ar: p.name_ar,
    action: !p.existing ? 'create' : p.changes.length ? 'update' : 'unchanged', changes: p.changes,
  }));
  const result: ImportResult = {
    total: planned.length + errors.length,
    create: changes.filter((c) => c.action === 'create').length,
    update: changes.filter((c) => c.action === 'update').length,
    unchanged: changes.filter((c) => c.action === 'unchanged').length,
    errors,
    changes: changes.filter((c) => c.action !== 'unchanged').slice(0, 300),
    applied: false,
  };
  if (!apply) return result;
  if (errors.length) throw AppError.unprocessable(`لا يمكن التطبيق: يوجد ${errors.length} خطأ في الملف — صححها ثم أعد الاستيراد`);

  await withTransaction(ctx, async (db) => {
    for (const p of planned) {
      if (!p.existing) {
        await db.query(
          `INSERT INTO items (code, name_ar, name_en, category, storage_condition, unit, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [p.code, p.name_ar, p.name_en, p.category, p.storage, p.unit, p.active],
        );
      } else if (p.changes.length) {
        await db.query(
          `UPDATE items SET name_ar = $2, name_en = $3, category = $4, storage_condition = $5, unit = $6, is_active = $7 WHERE id = $1`,
          [p.existing.id, p.name_ar, p.name_en, p.category, p.storage, p.unit, p.active],
        );
      }
    }
  });
  return { ...result, applied: true };
}
