import { z } from 'zod';
import type { Ccp, FormField, Limits } from '../models/haccp.model';
import type { Deviation } from '../models/record.model';

export type { Limits };

/**
 * Critical limits of a numeric field:
 *  - the CCP is the single source of truth for the primary measurement,
 *  - `limitsBy` picks the limits from another field's answer (chilled 2–8 °C, frozen ≤ −18 °C…),
 *  - otherwise the field's own min / max.
 */
export function effectiveLimits(field: FormField, ccp: Ccp | null | undefined, data?: Record<string, unknown>): Limits {
  if (field.ccpMeasurement && ccp) {
    return { min: ccp.min_value ?? undefined, max: ccp.max_value ?? undefined };
  }
  if (field.limitsBy && data) {
    const selected = data[field.limitsBy.field];
    const limits = typeof selected === 'string' ? field.limitsBy.cases[selected] : undefined;
    if (limits) return { min: limits.min, max: limits.max };
  }
  return { min: field.min, max: field.max };
}

export function describeLimits({ min, max }: Limits, unit = ''): string {
  if (min !== undefined && max !== undefined) return `${min}–${max} ${unit}`.trim();
  if (min !== undefined) return `≥ ${min} ${unit}`.trim();
  if (max !== undefined) return `≤ ${max} ${unit}`.trim();
  return '';
}

/** Human-readable limits for the form (all `limitsBy` cases when they depend on another answer). */
export function limitText(field: FormField, ccp: Ccp | null | undefined): string | undefined {
  const unit = field.ccpMeasurement && ccp ? ccp.unit : field.unit;
  if (field.durationFrom && field.maxMinutes) return `المدة ≤ ${field.maxMinutes} دقيقة`;
  if (field.limitsBy && !(field.ccpMeasurement && ccp)) {
    return Object.entries(field.limitsBy.cases).map(([k, l]) => `${k}: ${describeLimits(l, unit)}`).join(' · ') || undefined;
  }
  return describeLimits(effectiveLimits(field, ccp), unit) || undefined;
}

export const isComputed = (f: FormField) => !!f.compute;

/** Builds a strict Zod schema from a template's field definitions (types, required, options, hard ranges). */
export function buildDataSchema(fields: FormField[], opts: { carried?: Set<string> } = {}) {
  const shape: Record<string, z.ZodType> = {};
  for (const f of fields) {
    // Server-calculated values are never taken from the client.
    if (f.compute) continue;
    let s: z.ZodType;
    switch (f.type) {
      case 'number': {
        let n = z.number({ error: `${f.labelAr}: قيمة رقمية مطلوبة` }).finite().min(-100000).max(100000);
        if (f.validMin !== undefined) n = n.min(f.validMin, `${f.labelAr}: الحد الأدنى المسموح ${f.validMin}`);
        if (f.validMax !== undefined) n = n.max(f.validMax, `${f.labelAr}: الحد الأعلى المسموح ${f.validMax}`);
        s = n;
        break;
      }
      case 'boolean':
        s = z.boolean({ error: `${f.labelAr}: نعم / لا` });
        break;
      case 'date':
        s = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${f.labelAr}: تاريخ بصيغة YYYY-MM-DD`)
          .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), `${f.labelAr}: تاريخ غير صالح`);
        break;
      case 'month':
        s = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, `${f.labelAr}: الشهر بصيغة YYYY-MM`);
        break;
      case 'time':
        s = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, `${f.labelAr}: الوقت بصيغة HH:MM`);
        break;
      case 'select':
        // A company-maintained list that is still empty accepts free text until the list is filled.
        s = f.companyOptions && !f.options?.length
          ? z.string().trim().min(1, `${f.labelAr} مطلوب`).max(200)
          : z.enum((f.options?.length ? f.options : ['']) as [string, ...string[]], { error: `${f.labelAr}: اختيار غير صالح` });
        break;
      default: {
        let t = z.string().trim().min(f.required ? 1 : 0, `${f.labelAr} مطلوب`).max(500);
        if (f.pattern) t = t.regex(new RegExp(f.pattern), f.patternMessage ?? `${f.labelAr}: صيغة غير صحيحة`);
        s = t;
      }
    }
    // CCP readings are always mandatory, whatever the template says; carried values come from the server.
    const mandatory = (f.required || f.ccpMeasurement) && !opts.carried?.has(f.key);
    shape[f.key] = mandatory ? s : s.nullish();
  }
  return z.strictObject(shape);
}

/** Cross-field rules that refuse the entry (PRD "strict rules"), e.g. expiry_date > mfg_date. */
export function checkStrictRules(fields: FormField[], data: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const f of fields) {
    if (f.after) {
      const v = data[f.key];
      const ref = data[f.after];
      const refField = fields.find((x) => x.key === f.after);
      if (typeof v === 'string' && typeof ref === 'string' && !(v > ref)) {
        errors.push(`${f.labelAr} (${v}) يجب أن يكون بعد ${refField?.labelAr ?? f.after} (${ref}) — تم رفض الإدخال`);
      }
    }
  }
  return errors;
}

const DAY_MS = 86_400_000;
const dayNumber = (isoDate: string) => Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`) / DAY_MS;

/** Fills the server-calculated fields (sum / daysUntil / expiryStatus). `today` is YYYY-MM-DD in the company's timezone. */
export function computeFields(fields: FormField[], data: Record<string, unknown>, today: string): string[] {
  const errors: string[] = [];
  for (const f of fields) {
    const c = f.compute;
    if (!c || c.kind === 'compliance') continue;
    if (c.kind === 'sum') {
      const total = c.terms.reduce((acc, t) => acc + t.sign * (typeof data[t.field] === 'number' ? (data[t.field] as number) : 0), 0);
      data[f.key] = Math.round(total * 1000) / 1000;
    } else {
      const date = data[c.field];
      if (typeof date !== 'string') {
        data[f.key] = null;
        continue;
      }
      const days = Math.round(dayNumber(date) - dayNumber(today));
      data[f.key] = c.kind === 'daysUntil' ? days : days < 0 ? 'Expired' : days <= c.warnDays ? 'Expiring Soon' : 'Safe';
    }
    const v = data[f.key];
    if (typeof v === 'number') {
      if (f.validMin !== undefined && v < f.validMin) errors.push(`${f.labelAr} = ${v}: لا يمكن أن يقل عن ${f.validMin} — راجع القيم المدخلة`);
      if (f.validMax !== undefined && v > f.validMax) errors.push(`${f.labelAr} = ${v}: لا يمكن أن يزيد عن ${f.validMax} — راجع القيم المدخلة`);
    }
  }
  return errors;
}

/** Fills `compliance` fields from the deviations found, then enforces `onCriticalDeviation` answers. */
export function applyCompliance(fields: FormField[], data: Record<string, unknown>, deviations: Deviation[]): string[] {
  for (const f of fields) {
    if (f.compute?.kind === 'compliance') {
      const watched = f.compute.fields;
      data[f.key] = deviations.some((d) => watched.includes(d.field)) ? 'Non-Compliant' : 'Compliant';
    }
  }
  const errors: string[] = [];
  if (deviations.some((d) => d.critical)) {
    for (const f of fields) {
      if (f.onCriticalDeviation && data[f.key] !== f.onCriticalDeviation) {
        const label = f.optionLabels?.[f.onCriticalDeviation] ?? f.onCriticalDeviation;
        errors.push(`${f.labelAr}: يجب أن يكون "${label}" لوجود انحراف حرج`);
      }
    }
  }
  return errors;
}

/** Minutes from HH:MM `from` to HH:MM `to`, crossing midnight when needed. */
export function minutesBetween(from: string, to: string): number {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return (toMin(to) - toMin(from) + 1440) % 1440;
}

export interface Evaluation {
  status: 'PASS' | 'FAIL';
  deviations: Deviation[];
  measuredValue: number | null;
  unit: string | null;
}

/**
 * Compares submitted values against critical limits.
 * - numeric fields: min / max (CCP limits for the CCP measurement, `limitsBy` for conditional limits)
 * - boolean checks: `expected` answer
 * - FEFO status: Expiring Soon (deviation) / Expired (critical)
 * Any deviation makes the record FAIL; deviations on the CCP measurement are flagged critical.
 */
export function evaluate(fields: FormField[], data: Record<string, unknown>, ccp: Ccp | null | undefined): Evaluation {
  const deviations: Deviation[] = [];
  let measuredValue: number | null = null;
  let unit: string | null = null;

  for (const field of fields) {
    const value = data[field.key];
    if (value === undefined || value === null || value === '') continue;

    if (field.type === 'number' && typeof value === 'number') {
      const limits = effectiveLimits(field, ccp, data);
      const fieldUnit = field.ccpMeasurement && ccp ? ccp.unit : field.unit ?? '';
      if (field.ccpMeasurement) {
        measuredValue = value;
        unit = fieldUnit || null;
      }
      const below = limits.min !== undefined && value < limits.min;
      const above = limits.max !== undefined && value > limits.max;
      if (below || above) {
        const limit = describeLimits(limits, fieldUnit);
        deviations.push({
          field: field.key,
          label: field.labelAr,
          value,
          limit,
          critical: !!(field.ccpMeasurement || field.critical),
          message: `${field.labelEn}: ${value} ${fieldUnit} is ${below ? 'below' : 'above'} the critical limit (${limit})`.replace(/\s+/g, ' '),
        });
      }
    }

    if (field.compute?.kind === 'expiryStatus' && (value === 'Expiring Soon' || value === 'Expired')) {
      const expired = value === 'Expired';
      deviations.push({
        field: field.key,
        label: field.labelAr,
        value: field.optionLabels?.[value] ?? value,
        limit: `> ${field.compute.warnDays} days`,
        critical: expired || !!field.critical,
        message: expired
          ? `${field.labelEn}: product expired — block use and move to waste`
          : `${field.labelEn}: expires within ${field.compute.warnDays} days — dispatch first (FEFO)`,
      });
    }

    if (field.type === 'time' && field.durationFrom && field.maxMinutes !== undefined && typeof value === 'string') {
      const start = data[field.durationFrom];
      if (typeof start === 'string') {
        const minutes = minutesBetween(start, value);
        if (minutes > field.maxMinutes) {
          deviations.push({
            field: field.key,
            label: field.labelAr,
            value: `${minutes} min`,
            limit: `≤ ${field.maxMinutes} min`,
            critical: !!(field.ccpMeasurement || field.critical),
            message: `${field.labelEn}: ${minutes} min exceeds the time limit of ${field.maxMinutes} min`,
          });
        }
      }
    }

    if (field.type === 'boolean' && field.expected !== undefined && value !== field.expected) {
      deviations.push({
        field: field.key,
        label: field.labelAr,
        value,
        limit: field.expected ? 'Yes' : 'No',
        critical: !!(field.ccpMeasurement || field.critical),
        message: `${field.labelEn}: non-compliant answer`,
      });
    }
  }

  return { status: deviations.length ? 'FAIL' : 'PASS', deviations, measuredValue, unit };
}

const limitsSchema = z.object({ min: z.number().optional(), max: z.number().optional() })
  .refine((l) => l.min === undefined || l.max === undefined || l.min <= l.max, { message: 'min must be ≤ max' });
const fieldKey = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, 'key must be snake_case');

const computeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sum'), terms: z.array(z.object({ field: fieldKey, sign: z.union([z.literal(1), z.literal(-1)]) })).min(1).max(20) }),
  z.object({ kind: z.literal('daysUntil'), field: fieldKey }),
  z.object({ kind: z.literal('expiryStatus'), field: fieldKey, warnDays: z.number().int().min(0).max(365) }),
  z.object({ kind: z.literal('compliance'), fields: z.array(fieldKey).min(1).max(20) }),
]);

const safeRegex = z.string().max(200).refine((p) => {
  try {
    new RegExp(p);
    return true;
  } catch {
    return false;
  }
}, 'invalid regular expression');

/** Validates the structure of a template's field list (platform library, company forms). */
export const formFieldSchema = z
  .object({
    key: fieldKey,
    labelAr: z.string().trim().min(1).max(150),
    labelEn: z.string().trim().min(1).max(150),
    type: z.enum(['number', 'text', 'boolean', 'date', 'select', 'time', 'month']),
    hint: z.string().max(300).optional(),
    unit: z.string().max(10).optional(),
    required: z.boolean().optional(),
    options: z.array(z.string().trim().min(1).max(100)).max(200).optional(),
    optionLabels: z.record(z.string(), z.string().max(100)).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    validMin: z.number().optional(),
    validMax: z.number().optional(),
    limitsBy: z.object({ field: fieldKey, cases: z.record(z.string(), limitsSchema) }).optional(),
    after: fieldKey.optional(),
    pattern: safeRegex.optional(),
    patternMessage: z.string().max(200).optional(),
    unique: z.boolean().optional(),
    uniqueWith: z.array(fieldKey).max(5).optional(),
    carryFrom: fieldKey.optional(),
    carryMatch: z.array(fieldKey).max(5).optional(),
    compute: computeSchema.optional(),
    prefill: z.enum(['equipment.code', 'equipment.name', 'equipment.location', 'branch.name']).optional(),
    onCriticalDeviation: z.string().max(100).optional(),
    companyOptions: z.boolean().optional(),
    expected: z.boolean().optional(),
    ccpMeasurement: z.boolean().optional(),
    durationFrom: z.string().optional(),
    maxMinutes: z.number().int().positive().max(2880).optional(),
    critical: z.boolean().optional(),
  })
  .refine((f) => !f.durationFrom || (f.type === 'time' && f.maxMinutes !== undefined), {
    message: 'durationFrom requires a time field with maxMinutes',
  })
  .refine((f) => f.type !== 'select' || !!f.options?.length || f.companyOptions || f.compute, { message: 'select fields need options' })
  .refine((f) => f.min === undefined || f.max === undefined || f.min <= f.max, { message: 'min must be ≤ max' })
  .refine((f) => f.validMin === undefined || f.validMax === undefined || f.validMin <= f.validMax, { message: 'validMin must be ≤ validMax' })
  .refine((f) => !f.ccpMeasurement || f.type === 'number', { message: 'ccpMeasurement must be a number field' })
  .refine((f) => !f.limitsBy || f.type === 'number', { message: 'limitsBy applies to number fields' })
  .refine((f) => !f.after || f.type === 'date', { message: 'after applies to date fields' })
  .refine((f) => !f.pattern || f.type === 'text', { message: 'pattern applies to text fields' })
  .refine((f) => !f.onCriticalDeviation || (f.type === 'select' && (f.options ?? []).includes(f.onCriticalDeviation)), {
    message: 'onCriticalDeviation must be one of the select options',
  })
  .refine((f) => !f.compute || (f.compute.kind === 'sum' || f.compute.kind === 'daysUntil' ? f.type === 'number' : f.type === 'select'), {
    message: 'sum / daysUntil compute a number field; expiryStatus / compliance compute a select field',
  });

export const formFieldsSchema = z
  .array(formFieldSchema)
  .min(1)
  .max(60)
  .refine((fs) => new Set(fs.map((f) => f.key)).size === fs.length, { message: 'field keys must be unique' })
  .refine((fs) => fs.filter((f) => f.ccpMeasurement).length <= 1, { message: 'only one ccpMeasurement field is allowed' })
  .refine((fs) => fs.every((f) => !f.durationFrom || fs.some((s) => s.key === f.durationFrom && s.type === 'time')), {
    message: 'durationFrom must reference a time field of the same form',
  })
  .refine((fs) => fs.every((f) => !f.limitsBy || fs.some((s) => s.key === f.limitsBy!.field && s.type === 'select')), {
    message: 'limitsBy must reference a select field of the same form',
  })
  .refine((fs) => fs.every((f) => !f.after || fs.some((s) => s.key === f.after && s.type === 'date')), {
    message: 'after must reference a date field of the same form',
  })
  .refine((fs) => {
    const keys = new Set(fs.map((f) => f.key));
    return fs.every((f) => {
      const c = f.compute;
      const refs = [
        ...(f.uniqueWith ?? []), ...(f.carryMatch ?? []),
        ...(!c ? [] : c.kind === 'sum' ? c.terms.map((t) => t.field) : c.kind === 'compliance' ? c.fields : [c.field]),
      ];
      return refs.every((r) => keys.has(r) && r !== f.key);
    });
  }, { message: 'compute / uniqueWith / carryMatch must reference other fields of the same form' });
