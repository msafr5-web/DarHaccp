import type { Request, Response } from 'express';
import { z } from 'zod';
import { listAuditLogs } from '../models/audit.model';
import { ok, paginate } from '../utils/http';
import { isoDateTime, pagination, uuid } from '../utils/schemas';

export const auditQuery = pagination.extend({
  userId: uuid.optional(),
  entity: z.string().trim().max(60).optional(),
  entityId: z.string().trim().max(64).optional(),
  action: z.string().trim().toUpperCase().max(30).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
});

export async function list(req: Request, res: Response) {
  const q = req.valid.query as z.infer<typeof auditQuery>;
  const { rows, total } = await listAuditLogs({ ...q, ...paginate(q.page, q.pageSize) });
  return ok(res, rows, { page: q.page, pageSize: q.pageSize, total });
}
