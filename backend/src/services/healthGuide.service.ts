import { DbContext, query, Queryable, runAsSystem, withTransaction } from '../config/database';
import * as seed from '../db/healthGuideSeed';
import { AppError } from '../utils/AppError';

/**
 * Health certificate knowledge base: the four tabs (requirements, target activities, medical tests, issuance steps),
 * their sources, the safe seed upgrade, the platform administrator's edits, and the per-worker process tracker.
 */

export type Kind = 'requirements' | 'activities' | 'tests' | 'steps';
export const TABLES: Record<Kind, string> = {
  requirements: 'hc_requirements', activities: 'hc_activities', tests: 'hc_medical_tests', steps: 'hc_issuance_steps',
};

/** Inserts missing rows and upgrades rows still untouched by the administrator (`edited = false`) when REVISION grows. */
export async function syncHealthGuide(db: Queryable) {
  for (const s of seed.sources) {
    await db.query(
      `INSERT INTO hc_sources (code, title, publisher, url, level, retrieved_on) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, publisher = EXCLUDED.publisher, url = EXCLUDED.url,
                                        level = EXCLUDED.level, retrieved_on = EXCLUDED.retrieved_on`,
      [s.code, s.title, s.publisher, s.url, s.level, seed.RETRIEVED],
    );
  }
  const upgrade = (table: string) => `ON CONFLICT (code) DO UPDATE SET %SET%, seed_revision = EXCLUDED.seed_revision
     WHERE ${table}.edited = FALSE AND ${table}.seed_revision < EXCLUDED.seed_revision`;
  for (const r of seed.requirements) {
    await db.query(
      `INSERT INTO hc_requirements (code, kind, title_ar, detail_ar, value_text, items, source_code, sort, verification, verified_on, seed_revision)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ${upgrade('hc_requirements').replace('%SET%',
        'kind = EXCLUDED.kind, title_ar = EXCLUDED.title_ar, detail_ar = EXCLUDED.detail_ar, value_text = EXCLUDED.value_text, items = EXCLUDED.items, source_code = EXCLUDED.source_code, sort = EXCLUDED.sort, verification = EXCLUDED.verification, verified_on = EXCLUDED.verified_on')}`,
      [r.code, r.kind, r.title, r.detail, r.value ?? null, JSON.stringify(r.items ?? []), r.source, r.sort, r.verification ?? 'OFFICIAL', seed.RETRIEVED, seed.REVISION],
    );
  }
  for (const a of seed.activities) {
    await db.query(
      `INSERT INTO hc_activities (code, sector, name_ar, examples_ar, keywords, notes_ar, source_code, sort, verification, verified_on, seed_revision)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ${upgrade('hc_activities').replace('%SET%',
        'sector = EXCLUDED.sector, name_ar = EXCLUDED.name_ar, examples_ar = EXCLUDED.examples_ar, keywords = EXCLUDED.keywords, notes_ar = EXCLUDED.notes_ar, source_code = EXCLUDED.source_code, sort = EXCLUDED.sort, verification = EXCLUDED.verification, verified_on = EXCLUDED.verified_on')}`,
      [a.code, a.sector, a.name, a.examples ?? null, a.keywords, a.notes ?? null, a.source, a.sort, a.verification ?? 'OFFICIAL', seed.RETRIEVED, seed.REVISION],
    );
  }
  for (const t of seed.medicalTests) {
    await db.query(
      `INSERT INTO hc_medical_tests (code, category, name_ar, purpose_ar, applicability, source_code, sort, verification, verified_on, seed_revision)
       VALUES ($1,$2,$3,$4,$5,'CLINICS_RIYADH',$6,'REPORTED',$7,$8) ${upgrade('hc_medical_tests').replace('%SET%',
        'category = EXCLUDED.category, name_ar = EXCLUDED.name_ar, purpose_ar = EXCLUDED.purpose_ar, applicability = EXCLUDED.applicability, source_code = EXCLUDED.source_code, sort = EXCLUDED.sort, verification = EXCLUDED.verification, verified_on = EXCLUDED.verified_on')}`,
      [t.code, t.category, t.name, t.purpose, t.applicability ?? 'COMMON', t.sort, seed.RETRIEVED, seed.REVISION],
    );
  }
  for (const s of seed.steps) {
    await db.query(
      `INSERT INTO hc_issuance_steps (code, step_no, title_ar, detail_ar, actor, system_name, tracked_by, conditional, source_code, verified_on, seed_revision)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ${upgrade('hc_issuance_steps').replace('%SET%',
        'step_no = EXCLUDED.step_no, title_ar = EXCLUDED.title_ar, detail_ar = EXCLUDED.detail_ar, actor = EXCLUDED.actor, system_name = EXCLUDED.system_name, tracked_by = EXCLUDED.tracked_by, conditional = EXCLUDED.conditional, source_code = EXCLUDED.source_code, verified_on = EXCLUDED.verified_on')}`,
      [s.code, s.no, s.title, s.detail, s.actor, s.system, s.trackedBy ?? null, s.conditional ?? false, s.source, seed.RETRIEVED, seed.REVISION],
    );
  }
}

// ---------------------------------------------------------------- reading

export interface GuideItem { id: string; code: string; source_code: string | null; verification: 'OFFICIAL' | 'REPORTED' | 'UNVERIFIED'; verified_on: string | null; is_active: boolean; edited: boolean; [k: string]: unknown }

const verified = `to_char(verified_on, 'YYYY-MM-DD') AS verified_on`;

/** The whole guide for the screen: the four tabs, their sources and when they were last checked. */
export async function readGuide(includeInactive = false) {
  const act = includeInactive ? '' : 'WHERE is_active';
  const [requirements, activities, tests, steps, sources] = await Promise.all([
    query<GuideItem>(`SELECT id, code, kind, title_ar, detail_ar, value_text, items, source_code, sort, verification, ${verified}, is_active, edited FROM hc_requirements ${act} ORDER BY sort`),
    query<GuideItem>(`SELECT id, code, sector, name_ar, examples_ar, keywords, cert_required, notes_ar, source_code, sort, verification, ${verified}, is_active, edited FROM hc_activities ${act} ORDER BY sort`),
    query<GuideItem>(`SELECT id, code, category, name_ar, purpose_ar, applicability, source_code, sort, verification, ${verified}, is_active, edited FROM hc_medical_tests ${act} ORDER BY sort`),
    query<GuideItem>(`SELECT id, code, step_no, title_ar, detail_ar, actor, system_name, tracked_by, conditional, source_code, verification, ${verified}, is_active, edited FROM hc_issuance_steps ${act} ORDER BY step_no`),
    query(`SELECT code, title, publisher, url, level, to_char(retrieved_on, 'YYYY-MM-DD') AS retrieved_on FROM hc_sources ORDER BY id`),
  ]);
  const eduCities = (requirements.rows.find((r) => r.code === 'REQ_EDU')?.items as string[] | undefined) ?? [];
  const dates = [requirements, activities, tests, steps].flatMap((t) => t.rows.map((r) => r.verified_on)).filter(Boolean) as string[];
  return {
    requirements: requirements.rows, activities: activities.rows, tests: tests.rows, steps: steps.rows, sources: sources.rows,
    eduCities, lastVerified: dates.sort().at(-1) ?? null,
  };
}

// ---------------------------------------------------------------- platform administrator

const EDITABLE: Record<Kind, Record<string, string>> = {
  requirements: { titleAr: 'title_ar', detailAr: 'detail_ar', valueText: 'value_text', items: 'items', verification: 'verification', isActive: 'is_active' },
  activities: { nameAr: 'name_ar', examplesAr: 'examples_ar', keywords: 'keywords', certRequired: 'cert_required', notesAr: 'notes_ar', verification: 'verification', isActive: 'is_active' },
  tests: { nameAr: 'name_ar', purposeAr: 'purpose_ar', applicability: 'applicability', verification: 'verification', isActive: 'is_active' },
  steps: { titleAr: 'title_ar', detailAr: 'detail_ar', verification: 'verification', isActive: 'is_active' },
};

/** Edits one item; it is then protected from seed upgrades and stamped as verified today. */
export async function updateGuideItem(ctx: DbContext, kind: Kind, id: string, patch: Record<string, unknown>) {
  const cols = EDITABLE[kind];
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [key, value] of Object.entries(patch)) {
    const col = cols[key];
    if (!col || value === undefined) continue;
    params.push(col === 'items' ? JSON.stringify(value) : value);
    sets.push(`${col} = $${params.length}${col === 'items' ? '::jsonb' : ''}`);
  }
  if (!sets.length) throw AppError.unprocessable('لا توجد تغييرات');
  const table = TABLES[kind];
  const row = await runAsSystem(() => withTransaction({ ...ctx, bypass: true }, async (db) => {
    const r = await db.query(`UPDATE ${table} SET ${sets.join(', ')}, edited = TRUE, verified_on = CURRENT_DATE WHERE id = $1 RETURNING id`, params);
    return r.rows[0];
  }));
  if (!row) throw AppError.notFound('Guide item');
  return readGuide(true);
}

// ---------------------------------------------------------------- process tracker (per register entry)

export type StepState = 'DONE' | 'CURRENT' | 'PENDING' | 'SKIPPED' | 'BLOCKED';
export interface ProcessStep { code: string; step_no: number; title: string; state: StepState; note?: string }

export interface ProcessContext {
  eduCities: string[];
  milestones: { code: string; step_no: number; title_ar: string; tracked_by: string; conditional: boolean }[];
  activities: { code: string; name_ar: string; keywords: string[] }[];
}

/** Everything the register needs to interpret an entry; loaded once per request. */
export async function loadProcessContext(): Promise<ProcessContext> {
  const [req, steps, acts] = await Promise.all([
    query<{ items: string[] }>(`SELECT items FROM hc_requirements WHERE code = 'REQ_EDU'`),
    query<ProcessContext['milestones'][number]>(`SELECT code, step_no, title_ar, tracked_by, conditional FROM hc_issuance_steps WHERE is_active AND tracked_by IS NOT NULL ORDER BY step_no`),
    query<ProcessContext['activities'][number]>(`SELECT code, name_ar, keywords FROM hc_activities WHERE is_active ORDER BY sort`),
  ]);
  return { eduCities: req.rows[0]?.items ?? [], milestones: steps.rows, activities: acts.rows };
}

const stripCity = (s: string) => s.replace(/\(.*?\)/g, '').replace(/[\sـ]/g, '').replace(/^(مدينة|منطقة|أمانة)/, '');

/** Health education applies in the cities where the Amana activated it (matched by the city name the user typed). */
export function eduRequired(city: string | null, eduCities: string[]): boolean {
  if (!city) return false;
  const c = stripCity(city);
  if (c.length < 2) return false;
  return eduCities.some((e) => {
    const names = [e, ...e.split('(')].map((x) => stripCity(x.replace(')', '')));
    return names.some((n) => n && (n === c || n.includes(c) || c.includes(n)));
  });
}

/** Suggests the activity from the profession / internal section text (used when none was chosen). */
export function guessActivity(text: string, activities: ProcessContext['activities']): string | null {
  const t = text.replace(/\s+/g, ' ');
  return activities.find((a) => a.keywords.some((k) => t.includes(k)))?.code ?? null;
}

interface TrackedEntry {
  exam_status: 'FIT' | 'PENDING' | 'UNFIT';
  cert_status: string;
  cert_expiry: string | null;
  request_no: string | null;
  edu_status: 'PENDING' | 'PASSED' | 'FAILED';
  fee_paid_on: string | null;
  city: string | null;
}

/**
 * Where the worker is in the issuance process. Facts only: a certificate that is in force (valid / expiring)
 * means every step is done, whatever was or was not recorded; otherwise each milestone is read from its register
 * column. An unfit result or a failed health-education test blocks the steps after it.
 */
export function trackProcess(e: TrackedEntry, ctx: ProcessContext): { steps: ProcessStep[]; next: ProcessStep | null; eduRequired: boolean; done: number; total: number } {
  const needsEdu = eduRequired(e.city, ctx.eduCities);
  const inForce = e.exam_status === 'FIT' && !!e.cert_expiry && (e.cert_status === 'VALID' || e.cert_status === 'EXPIRING');
  const renewal = e.cert_status === 'EXPIRED';
  const out: ProcessStep[] = [];
  let blocked = false;
  let currentTaken = false;

  for (const m of ctx.milestones) {
    let state: StepState;
    let note: string | undefined;
    if (m.tracked_by === 'edu_status' && !needsEdu) {
      state = 'SKIPPED';
      note = e.city ? 'غير مفعّل في مدينة المنشأة' : 'حدّد المدينة لمعرفة انطباقه';
    } else if (inForce) {
      state = 'DONE';
    } else if (blocked) {
      state = 'PENDING';
    } else {
      let ok: boolean;
      let bad = false;
      switch (m.tracked_by) {
        case 'request_no': ok = !!e.request_no && !renewal; break;
        case 'exam_status': ok = e.exam_status === 'FIT' && !renewal; bad = e.exam_status === 'UNFIT'; break;
        case 'edu_status': ok = e.edu_status === 'PASSED'; bad = e.edu_status === 'FAILED'; break;
        case 'fee_paid_on': ok = !!e.fee_paid_on && !renewal; break;
        default: ok = false;
      }
      if (ok) state = 'DONE';
      else if (bad) { state = 'BLOCKED'; blocked = true; note = m.tracked_by === 'exam_status' ? 'نتيجة الفحص «غير لائق»' : 'الرسوب في اختبار التثقيف'; }
      else if (!currentTaken) { state = 'CURRENT'; currentTaken = true; }
      else state = 'PENDING';
    }
    out.push({ code: m.code, step_no: m.step_no, title: m.title_ar, state, note });
  }
  const counted = out.filter((s) => s.state !== 'SKIPPED');
  return {
    steps: out,
    next: out.find((s) => s.state === 'CURRENT' || s.state === 'BLOCKED') ?? null,
    eduRequired: needsEdu,
    done: counted.filter((s) => s.state === 'DONE').length,
    total: counted.length,
  };
}
