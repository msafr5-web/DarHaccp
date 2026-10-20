import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, withTransaction } from '../config/database';
import { signAccessToken } from '../middlewares/auth';
import { insertAuditEvent } from '../models/audit.model';
import { findUserById, findUserForLogin } from '../models/user.model';
import { AppError } from '../utils/AppError';
import { dbContext, ok, requireUser } from '../utils/http';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
// Used when the e-mail is unknown so response time does not reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync('timing-attack-mitigation', 12);

export const passwordPolicy = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .regex(/[A-Z]/, 'Password needs an uppercase letter')
  .regex(/[a-z]/, 'Password needs a lowercase letter')
  .regex(/\d/, 'Password needs a digit');

export const loginSchema = z.object({
  email: z.email().max(255),
  password: z.string().min(1).max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordPolicy,
});

export const pushTokenSchema = z.object({
  pushToken: z.string().regex(/^(ExponentPushToken|ExpoPushToken)\[[\w-]+\]$/, 'Invalid Expo push token').nullable(),
});

export async function login(req: Request, res: Response) {
  const { email, password } = req.valid.body as z.infer<typeof loginSchema>;
  const audit = { ip: req.ip, userAgent: req.get('user-agent'), requestId: req.requestId };
  const user = await findUserForLogin(email);

  if (user?.locked_until && new Date(user.locked_until) > new Date()) {
    throw new AppError(423, 'ACCOUNT_LOCKED', `Account temporarily locked. Try again after ${LOCK_MINUTES} minutes`);
  }

  const valid = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !valid || !user.is_active) {
    if (user) {
      await query(
        `UPDATE users SET failed_login_attempts = failed_login_attempts + 1,
                locked_until = CASE WHEN failed_login_attempts + 1 >= $2 THEN now() + make_interval(mins => $3) END
          WHERE id = $1`,
        [user.id, MAX_FAILED_ATTEMPTS, LOCK_MINUTES],
      );
    }
    await insertAuditEvent({ ...audit, userId: user?.id, action: 'LOGIN_FAILED', entity: 'auth', data: { email } });
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  await query(`UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [user.id]);
  await insertAuditEvent({ ...audit, userId: user.id, action: 'LOGIN', entity: 'auth', entityId: user.id });

  const { password_hash: _h, failed_login_attempts: _f, locked_until: _l, ...publicUser } = user;
  return ok(res, { token: signAccessToken(user.id, user.role), user: publicUser });
}

export async function me(req: Request, res: Response) {
  const user = await findUserById(requireUser(req).id);
  if (!user) throw AppError.notFound('User');
  return ok(res, user);
}

export async function changePassword(req: Request, res: Response) {
  const authUser = requireUser(req);
  const { currentPassword, newPassword } = req.valid.body as z.infer<typeof changePasswordSchema>;
  const { rows } = await query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [authUser.id]);
  if (!rows[0] || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
  }
  const hash = await bcrypt.hash(newPassword, 12);
  // password_changed_at revokes every token issued before now (see authenticate()).
  await withTransaction(dbContext(req), (db) =>
    db.query('UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1', [authUser.id, hash]),
  );
  const user = await findUserById(authUser.id);
  return ok(res, { token: signAccessToken(authUser.id, authUser.role), user });
}

export async function updatePushToken(req: Request, res: Response) {
  const { pushToken } = req.valid.body as z.infer<typeof pushTokenSchema>;
  await query('UPDATE users SET push_token = $2 WHERE id = $1', [requireUser(req).id, pushToken]);
  return ok(res, { registered: !!pushToken });
}
