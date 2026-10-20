import type { Request, Response } from 'express';
import { z } from 'zod';
import { listCapas } from '../models/capa.model';
import { closeCapa, getScopedCapa, updateCapa, verifyCapa } from '../services/capa.service';
import { dbContext, ok, paginate, requireUser } from '../utils/http';
import { resolveDepartmentScope } from '../utils/scope';
import { departmentCode, isoDate, optText, pagination, uuid } from '../utils/schemas';

export const listCapasQuery = pagination.extend({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'CLOSED', 'VERIFIED']).optional(),
  department: departmentCode.optional(),
  overdue: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

export const capaUpdateSchema = z.object({
  rootCause: optText(2000),
  correctiveAction: optText(2000),
  preventiveAction: optText(2000),
  immediateAction: optText(2000),
  productDisposition: z.enum(['RECOOK', 'REHEAT', 'RECHILL', 'DISCARD', 'HOLD', 'RETURN_TO_SUPPLIER', 'RELEASE']).optional(),
  assignedTo: uuid.nullable().optional(),
  dueDate: isoDate.optional(),
});

export const capaVerifySchema = z.object({ verificationNotes: z.string().trim().min(5).max(2000) });

export async function list(req: Request, res: Response) {
  const q = req.valid.query as z.infer<typeof listCapasQuery>;
  const departmentId = await resolveDepartmentScope(requireUser(req), q.department);
  const { rows, total } = await listCapas({ status: q.status, departmentId, overdue: q.overdue, ...paginate(q.page, q.pageSize) });
  return ok(res, rows, { page: q.page, pageSize: q.pageSize, total });
}

export async function get(req: Request, res: Response) {
  return ok(res, await getScopedCapa(requireUser(req), (req.valid.params as { id: string }).id));
}

export async function update(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  return ok(res, await updateCapa(dbContext(req), requireUser(req), id, req.valid.body));
}

export async function close(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  return ok(res, await closeCapa(dbContext(req), requireUser(req), id, req.valid.body));
}

export async function verify(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  const { verificationNotes } = req.valid.body as z.infer<typeof capaVerifySchema>;
  return ok(res, await verifyCapa(dbContext(req), requireUser(req), id, verificationNotes));
}
