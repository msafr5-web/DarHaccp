import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { query, runAsSystem, runInTenant, withTransaction } from '../config/database';
import { findEquipment } from '../models/equipment.model';
import { submitDeviceReading } from '../services/record.service';
import { AppError } from '../utils/AppError';
import { sha256 } from '../utils/crypto';
import { created, dbContext, ok } from '../utils/http';
import { isoDateTime } from '../utils/schemas';

export const readingSchema = z.object({
  value: z.number().finite().min(-100).max(400),
  recordedAt: isoDateTime.optional(),
});

/**
 * Issues (or rotates) the API key of a smart probe / data logger attached to a piece of equipment.
 * The key is shown once; only its SHA-256 hash is stored.
 */
export async function issueDeviceKey(req: Request, res: Response) {
  const { id } = req.valid.params as { id: string };
  const equipment = await findEquipment({ id });
  if (!equipment) throw AppError.notFound('Equipment');
  if (!equipment.form_template_id) throw AppError.unprocessable('Link a monitoring form to this equipment first');
  const key = `dk_${randomBytes(32).toString('base64url')}`;
  await withTransaction(dbContext(req), (db) => db.query('UPDATE equipment SET device_key_hash = $2 WHERE id = $1', [id, sha256(key)]));
  return created(res, {
    equipment: equipment.code,
    deviceKey: key,
    usage: 'POST /api/v1/iot/readings with header "X-Device-Key: <key>" and JSON body {"value": 3.5}',
  });
}

/** Sensor endpoint (no user session): authenticated by the device key. */
export async function ingestReading(req: Request, res: Response) {
  const key = req.get('x-device-key');
  if (!key || !/^dk_[\w-]{40,}$/.test(key)) throw AppError.unauthorized('Missing or malformed device key');
  const { rows } = await runAsSystem(() =>
    query<{ id: string; tenant_id: number }>('SELECT id, tenant_id FROM equipment WHERE device_key_hash = $1 AND is_active', [sha256(key)]),
  );
  if (!rows[0]) throw AppError.unauthorized('Unknown device');
  const b = req.valid.body as z.infer<typeof readingSchema>;

  return runInTenant(rows[0].tenant_id, async () => {
    const equipment = await findEquipment({ id: rows[0]!.id });
    if (!equipment) throw AppError.unauthorized('Unknown device');
    const record = await submitDeviceReading(equipment, b.value, b.recordedAt);
    return ok(res, { id: record?.id, status: record?.status, deviations: record?.deviations });
  });
}
