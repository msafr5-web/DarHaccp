import { DbContext, withTransaction } from '../config/database';
import { Capa, findCapaById } from '../models/capa.model';
import { canAccessDepartment } from '../middlewares/auth';
import type { AuthUser } from '../types/express';
import { AppError } from '../utils/AppError';

export interface CapaUpdate {
  rootCause?: string;
  correctiveAction?: string;
  preventiveAction?: string;
  immediateAction?: string;
  productDisposition?: string;
  assignedTo?: string | null;
  dueDate?: string;
}

export async function getScopedCapa(user: AuthUser, id: string): Promise<Capa> {
  const capa = await findCapaById(id);
  if (!capa || !canAccessDepartment(user, capa.department_id)) throw AppError.notFound('CAPA');
  return capa;
}

/** Investigation in progress: fill root cause / actions. Moves OPEN -> IN_PROGRESS. */
export async function updateCapa(ctx: DbContext, user: AuthUser, id: string, u: CapaUpdate) {
  const capa = await getScopedCapa(user, id);
  if (capa.status === 'CLOSED' || capa.status === 'VERIFIED') throw AppError.conflict('A closed CAPA cannot be edited');

  await withTransaction(ctx, (db) =>
    db.query(
      `UPDATE capas SET
          root_cause          = COALESCE($2, root_cause),
          corrective_action   = COALESCE($3, corrective_action),
          preventive_action   = COALESCE($4, preventive_action),
          immediate_action    = COALESCE($5, immediate_action),
          product_disposition = COALESCE($6, product_disposition),
          assigned_to         = CASE WHEN $7::boolean THEN $8::uuid ELSE assigned_to END,
          due_date            = COALESCE($9::date, due_date),
          status              = 'IN_PROGRESS'
        WHERE id = $1`,
      [
        id, u.rootCause ?? null, u.correctiveAction ?? null, u.preventiveAction ?? null, u.immediateAction ?? null,
        u.productDisposition ?? null, u.assignedTo !== undefined, u.assignedTo ?? null, u.dueDate ?? null,
      ],
    ),
  );
  return findCapaById(id);
}

/** Closing requires a documented corrective action; the linked alert becomes RESOLVED. */
export async function closeCapa(ctx: DbContext, user: AuthUser, id: string, u: CapaUpdate) {
  const capa = await getScopedCapa(user, id);
  if (capa.status === 'CLOSED' || capa.status === 'VERIFIED') throw AppError.conflict(`CAPA is already ${capa.status}`);

  const correctiveAction = u.correctiveAction ?? capa.corrective_action;
  const rootCause = u.rootCause ?? capa.root_cause;
  if (!correctiveAction || !rootCause) {
    throw AppError.unprocessable('Root cause and corrective action are required to close a CAPA');
  }

  await withTransaction(ctx, async (db) => {
    await db.query(
      `UPDATE capas SET root_cause = $2, corrective_action = $3,
              preventive_action = COALESCE($4, preventive_action),
              product_disposition = COALESCE($5, product_disposition),
              status = 'CLOSED', closed_by = $6, closed_at = now()
        WHERE id = $1`,
      [id, rootCause, correctiveAction, u.preventiveAction ?? null, u.productDisposition ?? null, user.id],
    );
    if (capa.alert_id) {
      await db.query(
        `UPDATE alerts SET status = 'RESOLVED', resolved_by = $2, resolved_at = now()
          WHERE id = $1 AND status <> 'RESOLVED'`,
        [capa.alert_id, user.id],
      );
    }
    // Incident / non-conformity CAPA: the incident closes with its investigation results.
    if (capa.incident_id) {
      await db.query(
        `UPDATE incidents SET status = 'CLOSED', root_cause = $2, corrective_action = $3, closed_by = $4, closed_at = now()
          WHERE id = $1`,
        [capa.incident_id, rootCause, correctiveAction, user.id],
      );
      await db.query(
        `UPDATE alerts SET status = 'RESOLVED', resolved_by = $2, resolved_at = now()
          WHERE source_type = 'INCIDENT' AND source_id = $1 AND status <> 'RESOLVED'`,
        [capa.incident_id, user.id],
      );
    }
  });
  return findCapaById(id);
}

/** HACCP verification (segregation of duties: the verifier cannot be the person who closed it). */
export async function verifyCapa(ctx: DbContext, user: AuthUser, id: string, notes: string) {
  const capa = await getScopedCapa(user, id);
  if (capa.status !== 'CLOSED') throw AppError.conflict('Only CLOSED CAPAs can be verified');
  if (capa.closed_by === user.id) throw AppError.forbidden('The CAPA must be verified by someone other than the person who closed it');

  await withTransaction(ctx, (db) =>
    db.query(
      `UPDATE capas SET status = 'VERIFIED', verified_by = $2, verified_at = now(), verification_notes = $3 WHERE id = $1`,
      [id, user.id, notes],
    ),
  );
  return findCapaById(id);
}
