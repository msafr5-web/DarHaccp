import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env, isProduction } from '../config/env';
import { logger } from '../config/logger';

/**
 * Field-level encryption for sensitive personal data (PRD §5: AES-256 at rest), on top of
 * the database's own disk encryption. Format: v1.<iv>.<authTag>.<ciphertext> (base64url).
 */
function dataKey(): Buffer {
  if (env.DATA_ENCRYPTION_KEY) return Buffer.from(env.DATA_ENCRYPTION_KEY, 'hex');
  if (isProduction) throw new Error('DATA_ENCRYPTION_KEY is required in production');
  logger.warn('DATA_ENCRYPTION_KEY not set — using a development key derived from JWT_SECRET');
  return createHash('sha256').update(`dev-data-key:${env.JWT_SECRET}`).digest();
}

let key: Buffer | null = null;
const getKey = () => (key ??= dataKey());

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decrypt(payload: string): string {
  const [version, iv, tag, data] = payload.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported ciphertext format');
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Short-lived signed links for pages opened outside the app (printable labels / data cards),
 * where the browser cannot attach the Authorization header.
 */
export function signPath(path: string, ttlSeconds = 600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = createHmac('sha256', env.JWT_SECRET).update(`${path}:${exp}`).digest('base64url');
  return `${path}?exp=${exp}&sig=${sig}`;
}

export function verifySignedPath(path: string, exp: string | undefined, sig: string | undefined): boolean {
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
  const expected = createHmac('sha256', env.JWT_SECRET).update(`${path}:${exp}`).digest();
  const received = Buffer.from(sig, 'base64url');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
