import type { Request, Response } from 'express';
import { z } from 'zod';
import { addPlatformAdmin, listPlatformAdmins, setPlatformAdminActive } from '../services/platformAdmin.service';
import { created, dbContext, ok, requireUser } from '../utils/http';
import { uuid } from '../utils/schemas';

export const idParams = z.object({ id: uuid });
export const addSchema = z.object({
  fullName: z.string().trim().min(2, 'الاسم مطلوب').max(150),
  // Pasted addresses often carry spaces or capitals: normalise first, then validate.
  email: z.string().trim().toLowerCase().max(255).pipe(z.email('بريد إلكتروني غير صالح')),
});
export const activeSchema = z.object({ isActive: z.boolean() });

export async function list(_req: Request, res: Response) {
  return ok(res, await listPlatformAdmins());
}

export async function add(req: Request, res: Response) {
  return created(res, await addPlatformAdmin(dbContext(req), req.valid.body as z.infer<typeof addSchema>, requireUser(req).fullName));
}

export async function setActive(req: Request, res: Response) {
  const { id } = req.valid.params as z.infer<typeof idParams>;
  return ok(res, await setPlatformAdminActive(dbContext(req), id, (req.valid.body as z.infer<typeof activeSchema>).isActive));
}
