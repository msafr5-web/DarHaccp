import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { env } from '../config/env';
import { findCcpById, findTemplate } from '../models/haccp.model';
import { findEquipment } from '../models/equipment.model';
import { canAccessDepartment } from '../middlewares/auth';
import type { AuthUser } from '../types/express';
import { AppError } from '../utils/AppError';
import { describeLimits, effectiveLimits } from './haccpRules';

/** 144-bit random, URL-safe and non-guessable (labels are physically exposed in kitchens). */
export function generateQrToken(): string {
  return randomBytes(18).toString('base64url');
}

export function buildQrPayload(token: string): string {
  return `${env.QR_BASE_URL.replace(/\/+$/, '')}/${token}`;
}

/** Accepts the full scanned payload (URL) or the bare token. */
export function extractToken(payload: string): string {
  const cleaned = payload.trim().split(/[?#]/)[0]!.replace(/\/+$/, '');
  const token = cleaned.slice(cleaned.lastIndexOf('/') + 1);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw AppError.badRequest('Unrecognised QR code');
  return token;
}

const QR_OPTIONS = { errorCorrectionLevel: 'M' as const, margin: 2, width: 512 };

export function renderQrPng(payload: string): Promise<Buffer> {
  return QRCode.toBuffer(payload, { ...QR_OPTIONS, type: 'png' });
}

export function renderQrSvg(payload: string): Promise<string> {
  return QRCode.toString(payload, { ...QR_OPTIONS, type: 'svg' });
}

export function renderQrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, QR_OPTIONS);
}

/**
 * Resolves a scanned QR code into the digital form to open on the mobile app.
 * A QR can identify a form template directly (e.g. "Meat receiving") or a piece of
 * equipment (e.g. "Fridge FR-COLD-01") which opens that equipment's check form pre-filled.
 */
export async function resolveQr(user: AuthUser, payload: string) {
  const token = extractToken(payload);

  let template = await findTemplate({ qrToken: token });
  let equipment = null;

  if (!template) {
    equipment = await findEquipment({ qrToken: token });
    if (!equipment || !equipment.is_active) throw AppError.notFound('QR code');
    if (!equipment.form_template_id) throw AppError.unprocessable(`No check form is linked to equipment ${equipment.code}`);
    if (equipment.status === 'OUT_OF_SERVICE') {
      throw new AppError(409, 'EQUIPMENT_OUT_OF_SERVICE', `${equipment.code} is out of service — do not use it for food storage/production`);
    }
    template = await findTemplate({ id: equipment.form_template_id });
  }

  if (!template) throw AppError.notFound('Form template');
  if (!template.is_active) throw new AppError(410, 'FORM_RETIRED', 'This form has been retired — please use the new label');

  const departmentId = equipment?.department_id ?? template.department_id;
  if (!canAccessDepartment(user, departmentId)) throw AppError.forbidden('This form belongs to another department');

  const ccp = template.ccp_id ? await findCcpById(template.ccp_id) : null;

  return {
    kind: equipment ? ('EQUIPMENT' as const) : ('FORM' as const),
    // Where the app should POST the completed form.
    department: equipment?.department_code ?? template.department_code ?? user.departmentCode,
    template: {
      id: template.id,
      code: template.code,
      titleAr: template.title_ar,
      titleEn: template.title_en,
      description: template.description,
      version: template.version,
      // Limits are resolved server-side so the app can warn the user live while typing.
      fields: template.fields.map((f) => {
        const limits = effectiveLimits(f, ccp);
        const unit = f.ccpMeasurement && ccp ? ccp.unit : f.unit;
        return { ...f, unit, min: limits.min, max: limits.max, limitText: describeLimits(limits, unit) || undefined };
      }),
    },
    ccp: ccp && {
      id: ccp.id,
      code: ccp.code,
      nameAr: ccp.name_ar,
      nameEn: ccp.name_en,
      hazard: ccp.hazard,
      criticalLimit: describeLimits({ min: ccp.min_value ?? undefined, max: ccp.max_value ?? undefined }, ccp.unit),
      correctiveAction: ccp.corrective_action,
    },
    equipment: equipment && {
      id: equipment.id,
      code: equipment.code,
      name: equipment.name,
      type: equipment.type,
      location: equipment.location,
      status: equipment.status,
    },
  };
}
