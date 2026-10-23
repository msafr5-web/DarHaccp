import type { Request, Response } from 'express';
import { z } from 'zod';
import { Alert, listAlerts } from '../models/alert.model';
import { canAccessDepartment } from '../middlewares/auth';
import { acknowledgeAlert, alertBus, resolveAlert } from '../services/alert.service';
import { dbContext, ok, paginate, requireUser } from '../utils/http';
import { resolveDepartmentScope } from '../utils/scope';
import { departmentCode, pagination } from '../utils/schemas';

export const listAlertsQuery = pagination.extend({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']).optional(),
  department: departmentCode.optional(),
});

export async function list(req: Request, res: Response) {
  const q = req.valid.query as z.infer<typeof listAlertsQuery>;
  const departmentId = await resolveDepartmentScope(requireUser(req), q.department);
  const { rows, total } = await listAlerts({ status: q.status, departmentId, ...paginate(q.page, q.pageSize) });
  return ok(res, rows, { page: q.page, pageSize: q.pageSize, total });
}

export async function acknowledge(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  return ok(res, await acknowledgeAlert(dbContext(req), requireUser(req), id));
}

export async function resolve(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  return ok(res, await resolveAlert(dbContext(req), requireUser(req), id));
}

/** Real-time alerts for control-room dashboards via Server-Sent Events. */
export function stream(req: Request, res: Response) {
  const user = requireUser(req);
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`event: ready\ndata: ${JSON.stringify({ userId: user.id })}\n\n`);

  const onAlert = (alert: Alert) => {
    // The bus is process-wide: only forward the company's own alerts.
    if (alert.tenant_id === user.tenantId && canAccessDepartment(user, alert.department_id)) {
      res.write(`id: ${alert.id}\nevent: alert\ndata: ${JSON.stringify(alert)}\n\n`);
    }
  };
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

  alertBus.on('alert', onAlert);
  req.on('close', () => {
    clearInterval(heartbeat);
    alertBus.off('alert', onAlert);
  });
}
