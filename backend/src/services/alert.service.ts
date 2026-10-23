import { EventEmitter } from 'node:events';
import { DbContext, query, runAsSystem, withTransaction } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { Alert, findAlertById } from '../models/alert.model';
import { AppError } from '../utils/AppError';
import type { AuthUser } from '../types/express';
import { canAccessDepartment } from '../middlewares/auth';
import { emails, sendEmail } from './email.service';

/** In-process bus feeding the Server-Sent Events stream (`GET /api/v1/alerts/stream`). */
export const alertBus = new EventEmitter();
alertBus.setMaxListeners(0);

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Fan-out a new alert: live dashboards (SSE) + mobile push notifications. Never throws. */
export function publishAlert(alert: Alert) {
  alertBus.emit('alert', alert);
  sendPushNotifications(alert).catch((err) => logger.error({ err, alertId: alert.id }, 'Push notification failed'));
  sendAlertEmails(alert).catch((err) => logger.error({ err, alertId: alert.id }, 'Alert e-mail failed'));
}

/** PRD: critical CCP deviations are also e-mailed to the company administrator and HACCP officers. */
async function sendAlertEmails(alert: Alert) {
  if (alert.source_type !== 'CCP_DEVIATION' || !['CRITICAL', 'HIGH'].includes(alert.severity)) return;
  const { rows } = await runAsSystem(() => query<{ email: string; company: string }>(
    `SELECT DISTINCT u.email, t.name AS company FROM users u JOIN tenants t ON t.id = u.tenant_id
      WHERE u.tenant_id = $1 AND u.is_active AND u.role IN ('ADMIN', 'HACCP_OFFICER')`,
    [alert.tenant_id],
  ));
  for (const r of rows) {
    await sendEmail(emails.criticalAlert(r.email, r.company, alert.title, alert.message, `${env.APP_URL}/alerts`));
  }
}

async function sendPushNotifications(alert: Alert) {
  if (!env.EXPO_PUSH_ENABLED) return;

  // Officers always; kitchen supervisors of the affected department; HSE for equipment/health alerts.
  const { rows } = await runAsSystem(() => query<{ push_token: string }>(
    `SELECT DISTINCT push_token FROM users
      WHERE is_active AND push_token IS NOT NULL AND tenant_id = $3
        AND ( role IN ('ADMIN', 'HACCP_OFFICER')
           OR (role = 'HSE_OFFICER' AND $2 <> 'CCP_DEVIATION')
           OR (role = 'KITCHEN_SUPERVISOR' AND ($1::smallint IS NULL OR department_id = $1)) )`,
    [alert.department_id, alert.source_type, alert.tenant_id],
  ));
  if (!rows.length) return;

  const messages = rows.map((r) => ({
    to: r.push_token,
    title: alert.title,
    body: alert.message,
    sound: 'default',
    priority: alert.severity === 'CRITICAL' || alert.severity === 'HIGH' ? 'high' : 'default',
    data: { alertId: alert.id, sourceType: alert.source_type, sourceId: alert.source_id },
  }));

  for (let i = 0; i < messages.length; i += 100) {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) logger.warn({ status: res.status }, 'Expo push service rejected the request');
  }
}

async function loadScopedAlert(user: AuthUser, id: string) {
  const alert = await findAlertById(id);
  if (!alert || !canAccessDepartment(user, alert.department_id)) throw AppError.notFound('Alert');
  return alert;
}

export async function acknowledgeAlert(ctx: DbContext, user: AuthUser, id: string) {
  const alert = await loadScopedAlert(user, id);
  if (alert.status !== 'OPEN') throw AppError.conflict(`Alert is already ${alert.status}`);
  return withTransaction(ctx, async (db) => {
    const { rows } = await db.query<Alert>(
      `UPDATE alerts SET status = 'ACKNOWLEDGED', acknowledged_by = $2, acknowledged_at = now()
        WHERE id = $1 AND status = 'OPEN' RETURNING *`,
      [id, user.id],
    );
    if (!rows[0]) throw AppError.conflict('Alert was modified concurrently');
    return rows[0];
  });
}

export async function resolveAlert(ctx: DbContext, user: AuthUser, id: string) {
  const alert = await loadScopedAlert(user, id);
  if (alert.status === 'RESOLVED') throw AppError.conflict('Alert is already resolved');
  if (alert.source_type === 'CCP_DEVIATION') {
    // CCP deviations are resolved through their CAPA (close & verify), never directly.
    const { rows } = await query<{ status: string }>(`SELECT status FROM capas WHERE alert_id = $1`, [id]);
    if (rows.some((c) => c.status !== 'CLOSED' && c.status !== 'VERIFIED')) {
      throw AppError.conflict('Close the linked CAPA before resolving this deviation alert');
    }
  }
  return withTransaction(ctx, async (db) => {
    const { rows } = await db.query<Alert>(
      `UPDATE alerts SET status = 'RESOLVED', resolved_by = $2, resolved_at = now(),
              acknowledged_by = COALESCE(acknowledged_by, $2), acknowledged_at = COALESCE(acknowledged_at, now())
        WHERE id = $1 AND status <> 'RESOLVED' RETURNING *`,
      [id, user.id],
    );
    if (!rows[0]) throw AppError.conflict('Alert was modified concurrently');
    return rows[0];
  });
}
