import { z } from 'zod';
import type { Ccp, FormField } from '../models/haccp.model';
import type { Deviation } from '../models/record.model';

export interface Limits {
  min?: number;
  max?: number;
}

/** The CCP is the single source of truth for critical limits of the primary measurement. */
export function effectiveLimits(field: FormField, ccp: Ccp | null | undefined): Limits {
  if (field.ccpMeasurement && ccp) {
    return { min: ccp.min_value ?? undefined, max: ccp.max_value ?? undefined };
  }
  return { min: field.min, max: field.max };
}

export function describeLimits({ min, max }: Limits, unit = ''): string {
  if (min !== undefined && max !== undefined) return `${min}–${max} ${unit}`.trim();
  if (min !== undefined) return `≥ ${min} ${unit}`.trim();
  if (max !== undefined) return `≤ ${max} ${unit}`.trim();
  return '';
}

/** Builds a strict Zod schema from a template's field definitions (types, required, options). */
export function buildDataSchema(fields: FormField[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const f of fields) {
    let s: z.ZodType;
    switch (f.type) {
      case 'number':
        s = z.number({ error: `${f.labelEn} must be a number` }).finite().min(-100000).max(100000);
        break;
      case 'boolean':
        s = z.boolean({ error: `${f.labelEn} must be yes/no` });
        break;
      case 'date':
        s = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${f.labelEn} must be a date (YYYY-MM-DD)`);
        break;
      case 'select':
        s = z.enum((f.options?.length ? f.options : ['']) as [string, ...string[]], { error: `${f.labelEn}: invalid option` });
        break;
      default:
        s = z.string().trim().min(f.required ? 1 : 0, `${f.labelEn} is required`).max(500);
    }
    // CCP readings are always mandatory, whatever the template says.
    shape[f.key] = f.required || f.ccpMeasurement ? s : s.nullish();
  }
  return z.strictObject(shape);
}

export interface Evaluation {
  status: 'PASS' | 'FAIL';
  deviations: Deviation[];
  measuredValue: number | null;
  unit: string | null;
}

/**
 * Compares submitted values against critical limits.
 * - numeric fields: min / max (CCP limits for the CCP measurement)
 * - boolean checks: `expected` answer
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
      const limits = effectiveLimits(field, ccp);
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
          critical: !!field.ccpMeasurement,
          message: `${field.labelEn}: ${value} ${fieldUnit} is ${below ? 'below' : 'above'} the critical limit (${limit})`.replace(/\s+/g, ' '),
        });
      }
    }

    if (field.type === 'boolean' && field.expected !== undefined && value !== field.expected) {
      deviations.push({
        field: field.key,
        label: field.labelAr,
        value,
        limit: field.expected ? 'Yes' : 'No',
        critical: !!field.ccpMeasurement,
        message: `${field.labelEn}: non-compliant answer`,
      });
    }
  }

  return { status: deviations.length ? 'FAIL' : 'PASS', deviations, measuredValue, unit };
}

/** Validates the structure of a template's field list (used when officers create/update forms). */
export const formFieldSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, 'key must be snake_case'),
    labelAr: z.string().min(1).max(150),
    labelEn: z.string().min(1).max(150),
    type: z.enum(['number', 'text', 'boolean', 'date', 'select']),
    unit: z.string().max(10).optional(),
    required: z.boolean().optional(),
    options: z.array(z.string().min(1).max(100)).min(1).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    expected: z.boolean().optional(),
    ccpMeasurement: z.boolean().optional(),
  })
  .refine((f) => f.type !== 'select' || !!f.options?.length, { message: 'select fields need options' })
  .refine((f) => f.min === undefined || f.max === undefined || f.min <= f.max, { message: 'min must be ≤ max' })
  .refine((f) => !f.ccpMeasurement || f.type === 'number', { message: 'ccpMeasurement must be a number field' });

export const formFieldsSchema = z
  .array(formFieldSchema)
  .min(1)
  .max(60)
  .refine((fs) => new Set(fs.map((f) => f.key)).size === fs.length, { message: 'field keys must be unique' })
  .refine((fs) => fs.filter((f) => f.ccpMeasurement).length <= 1, { message: 'only one ccpMeasurement field is allowed' });
