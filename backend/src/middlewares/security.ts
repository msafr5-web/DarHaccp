import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

export const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: { defaultSrc: ["'none'"], imgSrc: ["'self'", 'data:'], styleSrc: ["'self'", "'unsafe-inline'"], frameAncestors: ["'none'"] },
  },
  crossOriginResourcePolicy: { policy: 'same-site' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'no-referrer' },
});

const corsOptions = {
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id', 'RateLimit-Remaining'],
  maxAge: 600,
};

const isSameOrigin = (origin: string, host: string | undefined) => {
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
};

export const corsMiddleware = cors((req, callback) => {
  const origin = req.headers.origin;
  // Allowed: native apps (no Origin), the web app served from this same domain, and the allow-list.
  if (!origin || isSameOrigin(origin, req.headers.host) || env.CORS_ORIGINS.includes(origin)) {
    return callback(null, { ...corsOptions, origin: true });
  }
  callback(new AppError(403, 'CORS_REJECTED', `Origin ${origin} is not allowed`));
});

const rateLimitHandler = (_req: Request, _res: Response, next: NextFunction) =>
  next(new AppError(429, 'TOO_MANY_REQUESTS', 'Too many requests, please try again later'));

export const apiRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler,
});

/** Brute-force protection on login (counts failed attempts only). */
export const authRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler,
});

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.get('x-request-id');
  req.requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  req.valid = {};
  res.setHeader('X-Request-Id', req.requestId);
  next();
}
