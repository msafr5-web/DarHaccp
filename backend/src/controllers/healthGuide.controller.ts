import type { Request, Response } from 'express';
import { z } from 'zod';
import { runAsSystem } from '../config/database';
import { readGuide, updateGuideItem, type Kind } from '../services/healthGuide.service';
import { dbContext, ok } from '../utils/http';
import { uuid } from '../utils/schemas';

/** Health certificate guide: read by every company user, maintained by the platform administrator. */

export async function getGuide(_req: Request, res: Response) {
  return ok(res, await readGuide());
}

export async function getGuideAdmin(_req: Request, res: Response) {
  return ok(res, await runAsSystem(() => readGuide(true)));
}

export const guideItemParams = z.object({ kind: z.enum(['requirements', 'activities', 'tests', 'steps']), id: uuid });

const verification = z.enum(['OFFICIAL', 'REPORTED', 'UNVERIFIED']);
const text = (max: number) => z.string().trim().min(2).max(max);

/** One schema per tab: only these fields are editable (codes, sources and step order stay fixed). */
export const guideItemBodies: Record<Kind, z.ZodType> = {
  requirements: z.object({
    titleAr: text(200), detailAr: z.string().trim().min(2).max(4000), valueText: z.string().trim().max(80).nullable(),
    items: z.array(z.string().trim().min(1).max(120)).max(60), verification, isActive: z.boolean(),
  }).partial(),
  activities: z.object({
    nameAr: text(150), examplesAr: z.string().trim().max(1000).nullable(), keywords: z.array(z.string().trim().min(1).max(40)).max(40),
    certRequired: z.boolean(), notesAr: z.string().trim().max(2000).nullable(), verification, isActive: z.boolean(),
  }).partial(),
  tests: z.object({
    nameAr: text(150), purposeAr: z.string().trim().min(2).max(2000), applicability: z.enum(['COMMON', 'CASE_BY_CASE']), verification, isActive: z.boolean(),
  }).partial(),
  steps: z.object({ titleAr: text(200), detailAr: z.string().trim().min(2).max(4000), verification, isActive: z.boolean() }).partial(),
};

export async function updateItem(req: Request, res: Response) {
  const { kind, id } = req.valid.params as z.infer<typeof guideItemParams>;
  const body = guideItemBodies[kind].parse(req.body) as Record<string, unknown>;
  return ok(res, await updateGuideItem(dbContext(req), kind, id, body));
}
