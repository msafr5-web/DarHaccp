import type { Request, Response } from 'express';
import type { DbContext } from '../config/database';
import { AppError } from './AppError';

export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>) {
  return res.status(200).json({ success: true, data, ...(meta ? { meta } : {}) });
}

export function created<T>(res: Response, data: T) {
  return res.status(201).json({ success: true, data });
}

/** Builds the DB audit context (user, IP, UA, request id) from the current request. */
export function dbContext(req: Request): DbContext {
  return {
    userId: req.user?.id,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    requestId: req.requestId,
  };
}

export function requireUser(req: Request) {
  if (!req.user) throw AppError.unauthorized();
  return req.user;
}

export function paginate(page: number, pageSize: number) {
  return { limit: pageSize, offset: (page - 1) * pageSize };
}
