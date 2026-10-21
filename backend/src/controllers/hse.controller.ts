import type { Request, Response } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../config/database';
import { findDepartmentByCode } from '../models/department.model';
import { AppError } from '../utils/AppError';
import { created, dbContext, ok, requireUser } from '../utils/http';
import { departmentCode, isoDate, optText } from '../utils/schemas';

// ---------------------------------------------------------------- Contractors (PRD §4.1)

const serviceType = z.enum(['PEST_CONTROL', 'MAINTENANCE', 'CLEANING', 'WASTE_DISPOSAL', 'TRANSPORT', 'FIRE_SAFETY', 'OTHER']);

export const contractorSchema = z.object({
  name: z.string().trim().min(2).max(150),
  serviceType,
  crNumber: optText(30),
  contactName: optText(100),
  phone: optText(20),
  licenseNo: optText(60),
  licenseExpiry: isoDate.optional(),
  contractStart: isoDate.optional(),
  contractEnd: isoDate.optional(),
  notes: optText(1000),
});

export const contractorUpdateSchema = contractorSchema.partial().extend({ isApproved: z.boolean().optional() });

const score = z.number().int().min(1).max(5);
export const evaluationSchema = z.object({
  period: z.string().trim().regex(/^\d{4}-(Q[1-4]|H[12]|\d{2})$/, 'Period like 2026-Q4, 2026-H2 or 2026-10'),
  scores: z.object({ quality: score, compliance: score, timeliness: score, safety: score, documentation: score }),
  recommendation: z.enum(['CONTINUE', 'IMPROVE', 'TERMINATE']).optional(),
  notes: optText(2000),
});

export const listContractorsQuery = z.object({ serviceType: serviceType.optional() });

const CONTRACTOR_SELECT = `
  SELECT c.*,
         CASE WHEN c.license_expiry < CURRENT_DATE OR c.contract_end < CURRENT_DATE THEN 'EXPIRED'
              WHEN c.license_expiry <= CURRENT_DATE + 30 OR c.contract_end <= CURRENT_DATE + 30 THEN 'EXPIRING_SOON'
              ELSE 'VALID' END AS compliance_state,
         e.total_score AS last_score, e.period AS last_period, e.recommendation AS last_recommendation
    FROM contractors c
    LEFT JOIN LATERAL (SELECT * FROM contractor_evaluations ev WHERE ev.contractor_id = c.id ORDER BY ev.evaluated_at DESC LIMIT 1) e ON TRUE`;

export async function listContractors(req: Request, res: Response) {
  const { serviceType: type } = req.valid.query as z.infer<typeof listContractorsQuery>;
  const { rows } = await query(`${CONTRACTOR_SELECT} WHERE ($1::contractor_service IS NULL OR c.service_type = $1) ORDER BY c.name`, [type ?? null]);
  return ok(res, rows);
}

export async function getContractor(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  const { rows } = await query(`${CONTRACTOR_SELECT} WHERE c.id = $1`, [id]);
  if (!rows[0]) throw AppError.notFound('Contractor');
  const evaluations = await query(
    `SELECT ev.*, u.full_name AS evaluated_by_name FROM contractor_evaluations ev JOIN users u ON u.id = ev.evaluated_by
      WHERE ev.contractor_id = $1 ORDER BY ev.evaluated_at DESC`,
    [id],
  );
  return ok(res, { ...rows[0], evaluations: evaluations.rows });
}

export async function createContractor(req: Request, res: Response) {
  const b = req.valid.body as z.infer<typeof contractorSchema>;
  const row = await withTransaction(dbContext(req), async (db) => {
    const { rows } = await db.query(
      `INSERT INTO contractors (name, service_type, cr_number, contact_name, phone, license_no, license_expiry, contract_start, contract_end, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [b.name, b.serviceType, b.crNumber ?? null, b.contactName ?? null, b.phone ?? null, b.licenseNo ?? null,
        b.licenseExpiry ?? null, b.contractStart ?? null, b.contractEnd ?? null, b.notes ?? null],
    );
    return rows[0];
  });
  return created(res, row);
}

export async function updateContractor(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  const b = req.valid.body as z.infer<typeof contractorUpdateSchema>;
  const row = await withTransaction(dbContext(req), async (db) => {
    const { rows } = await db.query(
      `UPDATE contractors SET name = COALESCE($2, name), service_type = COALESCE($3, service_type),
              contact_name = COALESCE($4, contact_name), phone = COALESCE($5, phone), license_no = COALESCE($6, license_no),
              license_expiry = COALESCE($7, license_expiry), contract_start = COALESCE($8, contract_start),
              contract_end = COALESCE($9, contract_end), notes = COALESCE($10, notes), is_approved = COALESCE($11, is_approved),
              cr_number = COALESCE($12, cr_number)
        WHERE id = $1 RETURNING *`,
      [id, b.name ?? null, b.serviceType ?? null, b.contactName ?? null, b.phone ?? null, b.licenseNo ?? null,
        b.licenseExpiry ?? null, b.contractStart ?? null, b.contractEnd ?? null, b.notes ?? null, b.isApproved ?? null, b.crNumber ?? null],
    );
    return rows[0];
  });
  if (!row) throw AppError.notFound('Contractor');
  return ok(res, row);
}

/** Weighted equally across 5 criteria (1–5) → 0–100; recommendation derived unless overridden. */
export async function evaluateContractor(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  const b = req.valid.body as z.infer<typeof evaluationSchema>;
  const values = Object.values(b.scores);
  const total = Math.round((values.reduce((s, v) => s + v, 0) / (values.length * 5)) * 10000) / 100;
  const recommendation = b.recommendation ?? (total >= 80 ? 'CONTINUE' : total >= 60 ? 'IMPROVE' : 'TERMINATE');
  const row = await withTransaction(dbContext(req), async (db) => {
    const exists = await db.query('SELECT 1 FROM contractors WHERE id = $1', [id]);
    if (!exists.rowCount) throw AppError.notFound('Contractor');
    const { rows } = await db.query(
      `INSERT INTO contractor_evaluations (contractor_id, evaluated_by, period, scores, total_score, recommendation, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, requireUser(req).id, b.period, JSON.stringify(b.scores), total, recommendation, b.notes ?? null],
    );
    // A contractor rated "terminate" is no longer approved to work on site.
    if (recommendation === 'TERMINATE') await db.query('UPDATE contractors SET is_approved = FALSE WHERE id = $1', [id]);
    return rows[0];
  });
  return created(res, row);
}

// ---------------------------------------------------------------- Controlled documents (IMS policies, evacuation plans…)

const category = z.enum(['IMS_POLICY', 'HACCP_PLAN', 'SOP', 'EVACUATION_PLAN', 'FIRE_EXTINGUISHER_LAYOUT', 'EMERGENCY_PLAN', 'LICENSE', 'CERTIFICATE', 'OTHER']);

export const documentSchema = z.object({
  docNo: z.string().trim().min(2).max(40),
  title: z.string().trim().min(2).max(200),
  category,
  department: departmentCode.optional(),
  version: z.string().trim().max(20).default('1.0'),
  effectiveDate: isoDate,
  reviewDate: isoDate.optional(),
  fileUrl: z.url({ protocol: /^https$/ }).optional(),
});

export const documentUpdateSchema = documentSchema.omit({ docNo: true }).partial().extend({ isActive: z.boolean().optional() });
export const listDocumentsQuery = z.object({ category: category.optional() });

const DOCUMENT_SELECT = `
  SELECT doc.*, d.code AS department_code, u.full_name AS owner_name,
         CASE WHEN doc.review_date IS NULL THEN 'NO_REVIEW'
              WHEN doc.review_date < CURRENT_DATE THEN 'OVERDUE'
              WHEN doc.review_date <= CURRENT_DATE + 30 THEN 'DUE_SOON' ELSE 'CURRENT' END AS review_state
    FROM documents doc LEFT JOIN departments d ON d.id = doc.department_id LEFT JOIN users u ON u.id = doc.owner_id`;

export async function listDocuments(req: Request, res: Response) {
  const { category: cat } = req.valid.query as z.infer<typeof listDocumentsQuery>;
  const { rows } = await query(
    `${DOCUMENT_SELECT} WHERE doc.is_active AND ($1::document_category IS NULL OR doc.category = $1) ORDER BY doc.category, doc.doc_no`,
    [cat ?? null],
  );
  return ok(res, rows);
}

export async function createDocument(req: Request, res: Response) {
  const b = req.valid.body as z.infer<typeof documentSchema>;
  const deptId = b.department ? (await findDepartmentByCode(b.department))?.id ?? null : null;
  const row = await withTransaction(dbContext(req), async (db) => {
    const { rows } = await db.query(
      `INSERT INTO documents (doc_no, title, category, department_id, version, effective_date, review_date, file_url, owner_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [b.docNo, b.title, b.category, deptId, b.version, b.effectiveDate, b.reviewDate ?? null, b.fileUrl ?? null, requireUser(req).id],
    );
    return rows[0] as { id: string };
  });
  return created(res, (await query(`${DOCUMENT_SELECT} WHERE doc.id = $1`, [row.id])).rows[0]);
}

/** New version / review: the audit trail keeps every previous version's metadata. */
export async function updateDocument(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  const b = req.valid.body as z.infer<typeof documentUpdateSchema>;
  const result = await withTransaction(dbContext(req), (db) =>
    db.query(
      `UPDATE documents SET title = COALESCE($2, title), category = COALESCE($3, category), version = COALESCE($4, version),
              effective_date = COALESCE($5, effective_date), review_date = COALESCE($6, review_date),
              file_url = COALESCE($7, file_url), is_active = COALESCE($8, is_active)
        WHERE id = $1`,
      [id, b.title ?? null, b.category ?? null, b.version ?? null, b.effectiveDate ?? null, b.reviewDate ?? null,
        b.fileUrl ?? null, b.isActive ?? null],
    ),
  );
  if (!result.rowCount) throw AppError.notFound('Document');
  return ok(res, (await query(`${DOCUMENT_SELECT} WHERE doc.id = $1`, [id])).rows[0]);
}
