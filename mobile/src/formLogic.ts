import type { FormField, Limits } from './api/types';

/**
 * Client mirror of the server form rules (backend/src/services/haccpRules.ts), used for live
 * feedback while typing. The server re-applies every rule on submit and is the authority.
 */

export type Value = string | boolean | number | undefined | null;
export type Values = Record<string, Value>;

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const thisMonth = () => today().slice(0, 7);
export const nowTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
export const minutesBetween = (from: string, to: string) => {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return (m(to) - m(from) + 1440) % 1440;
};
export const isTime = (v: Value): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isDate = (v: Value): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export const toNumber = (v: Value): number | undefined => {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string' || v.trim() === '') return undefined;
  const n = Number(v.replace(',', '.').replace('−', '-'));
  return Number.isNaN(n) ? undefined : n;
};

/** Label of a stored option value (e.g. Accepted → مقبولة). */
export const optionLabel = (f: FormField, v: unknown) => (typeof v === 'string' ? f.optionLabels?.[v] ?? v : String(v ?? ''));

export const describeLimits = ({ min, max }: Limits, unit = '') =>
  min !== undefined && max !== undefined ? `${min}–${max} ${unit}`.trim()
    : min !== undefined ? `≥ ${min} ${unit}`.trim()
    : max !== undefined ? `≤ ${max} ${unit}`.trim() : '';

/** Limits currently in force (conditional limits follow the answer of the referenced field). */
export function activeLimits(f: FormField, values: Values): Limits {
  if (f.limitsBy && !f.ccpMeasurement) {
    const sel = values[f.limitsBy.field];
    return typeof sel === 'string' ? f.limitsBy.cases[sel] ?? {} : {};
  }
  return { min: f.min, max: f.max };
}

/** Server-calculated values, previewed live. */
export function computeValues(fields: FormField[], values: Values): Values {
  const out: Values = { ...values };
  for (const f of fields) {
    const c = f.compute;
    if (!c || c.kind === 'compliance') continue;
    if (c.kind === 'sum') {
      const parts = c.terms.map((t) => toNumber(out[t.field]));
      out[f.key] = parts.some((p) => p === undefined) ? undefined
        : Math.round(c.terms.reduce((acc, t, i) => acc + t.sign * (parts[i] ?? 0), 0) * 1000) / 1000;
    } else {
      const d = out[c.field];
      if (!isDate(d)) { out[f.key] = undefined; continue; }
      const days = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 86_400_000);
      out[f.key] = c.kind === 'daysUntil' ? days : days < 0 ? 'Expired' : days <= c.warnDays ? 'Expiring Soon' : 'Safe';
    }
  }
  for (const f of fields) {
    if (f.compute?.kind === 'compliance') {
      const watched = f.compute.fields;
      const any = fields.some((x) => watched.includes(x.key) && deviates(x, out[x.key], out));
      const answered = watched.every((k) => out[k] !== undefined && out[k] !== '');
      out[f.key] = answered ? (any ? 'Non-Compliant' : 'Compliant') : undefined;
    }
  }
  return out;
}

/** True when the answer breaches a critical limit (→ deviation, alert and CAPA on submit). */
export function deviates(field: FormField, raw: Value, values: Values): boolean {
  if (field.type === 'number') {
    const v = toNumber(raw);
    if (v === undefined) return false;
    const { min, max } = activeLimits(field, values);
    return (min !== undefined && v < min) || (max !== undefined && v > max);
  }
  if (field.compute?.kind === 'expiryStatus') return raw === 'Expiring Soon' || raw === 'Expired';
  if (field.type === 'boolean') return field.expected !== undefined && raw !== undefined && raw !== null && raw !== field.expected;
  if (field.type === 'time' && field.durationFrom && field.maxMinutes && isTime(raw)) {
    const start = values[field.durationFrom];
    return isTime(start) && minutesBetween(start, raw) > field.maxMinutes;
  }
  return false;
}

export function isCriticalDeviation(field: FormField, raw: Value, values: Values) {
  if (!deviates(field, raw, values)) return false;
  return !!(field.critical || field.ccpMeasurement || (field.compute?.kind === 'expiryStatus' && raw === 'Expired'));
}

/** Input errors the server would refuse (hard ranges, patterns, date order). */
export function inputError(f: FormField, raw: Value, values: Values): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (f.type === 'number') {
    const v = toNumber(raw);
    if (v === undefined) return 'قيمة رقمية غير صحيحة';
    if (f.validMin !== undefined && v < f.validMin) return `الحد الأدنى المسموح ${f.validMin}`;
    if (f.validMax !== undefined && v > f.validMax) return `الحد الأعلى المسموح ${f.validMax}`;
  }
  if (f.type === 'date' && !isDate(raw)) return 'التاريخ بصيغة YYYY-MM-DD';
  if (f.type === 'month' && !(typeof raw === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw))) return 'الشهر بصيغة YYYY-MM';
  if (f.type === 'time' && !isTime(raw)) return 'الوقت بصيغة HH:MM';
  if (f.pattern && typeof raw === 'string') {
    try {
      if (!new RegExp(f.pattern).test(raw.trim())) return f.patternMessage ?? 'صيغة غير صحيحة';
    } catch { /* invalid pattern: the server reports it */ }
  }
  if (f.after) {
    const ref = values[f.after];
    if (isDate(raw) && isDate(ref) && !(raw > ref)) return 'يجب أن يكون بعد التاريخ المرجعي — سيُرفض الإدخال';
  }
  return null;
}

/** Converts the form state to the JSON the API expects (numbers, trimmed text; computed fields omitted). */
export function toPayload(fields: FormField[], values: Values): { data: Record<string, unknown>; error: string | null } {
  const data: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.compute) continue;
    const v = values[f.key];
    if (v === undefined || v === null || v === '') continue;
    const err = inputError(f, v, values);
    if (err) return { data, error: `${f.labelAr}: ${err}` };
    data[f.key] = f.type === 'number' ? toNumber(v) : typeof v === 'string' ? v.trim() : v;
  }
  return { data, error: null };
}
