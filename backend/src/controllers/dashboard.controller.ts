import type { Request, Response } from 'express';
import { maybeCheckMonitoringGaps } from '../services/monitoring.service';
import { z } from 'zod';
import {
  getComplianceTrend,
  getDeviationAnalysis,
  getEquipmentSummary,
  getHealthCertificateSummary,
  getOverview,
} from '../services/dashboard.service';
import { ok, requireUser } from '../utils/http';
import { resolveDepartmentScope } from '../utils/scope';
import { departmentCode, isoDate, isoDateTime } from '../utils/schemas';

export const scopeQuery = z.object({ department: departmentCode.optional() });
export const overviewQuery = scopeQuery.extend({ date: isoDate.optional() });
export const trendQuery = scopeQuery.extend({ days: z.coerce.number().int().min(1).max(365).default(30) });
export const deviationsQuery = scopeQuery.extend({ from: isoDateTime.optional(), to: isoDateTime.optional() });

const scope = (req: Request) => resolveDepartmentScope(requireUser(req), (req.valid.query as { department?: never }).department);

export async function overview(req: Request, res: Response) {
  await maybeCheckMonitoringGaps(req.user!.tenantId); // periodic-monitoring gaps (throttled)
  const { date } = req.valid.query as z.infer<typeof overviewQuery>;
  return ok(res, await getOverview(date, await scope(req)));
}

export async function trend(req: Request, res: Response) {
  const { days } = req.valid.query as z.infer<typeof trendQuery>;
  return ok(res, await getComplianceTrend(days, await scope(req)));
}

export async function deviations(req: Request, res: Response) {
  const q = req.valid.query as z.infer<typeof deviationsQuery>;
  const to = q.to ?? new Date().toISOString();
  const from = q.from ?? new Date(Date.parse(to) - 30 * 24 * 3600 * 1000).toISOString();
  return ok(res, await getDeviationAnalysis(from, to, await scope(req)));
}

export async function healthCertificates(req: Request, res: Response) {
  return ok(res, await getHealthCertificateSummary(await scope(req)));
}

export async function equipment(req: Request, res: Response) {
  return ok(res, await getEquipmentSummary(await scope(req)));
}
