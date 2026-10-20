import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { isProduction } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../utils/AppError';

interface PgError extends Error {
  code: string;
  detail?: string;
  constraint?: string;
}

const isPgError = (err: unknown): err is PgError =>
  err instanceof Error && typeof (err as PgError).code === 'string' && /^[0-9A-Z]{5}$/.test((err as PgError).code);

/** Maps PostgreSQL error codes to meaningful HTTP errors. */
function fromPgError(err: PgError): AppError | null {
  switch (err.code) {
    case '23505':
      return AppError.conflict(`Duplicate value violates unique constraint (${err.constraint ?? 'unique'})`);
    case '23503':
      return AppError.conflict('Referenced record does not exist or is still in use');
    case '23514':
      return AppError.unprocessable(`Business rule violated (${err.constraint ?? 'check'})`);
    case '23502':
      return AppError.unprocessable('A required field is missing');
    case '22P02':
    case '22007':
    case '22008':
      return AppError.badRequest('Invalid identifier or value format');
    case '23001':
      return new AppError(409, 'IMMUTABLE_RECORD', 'This record is append-only and cannot be modified');
    default:
      return null;
  }
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`));
}

// Express recognises error handlers by their 4-argument signature.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let appError: AppError;

  if (err instanceof AppError) {
    appError = err;
  } else if (err instanceof ZodError) {
    appError = AppError.unprocessable(
      'Input validation failed',
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  } else if (isPgError(err) && fromPgError(err)) {
    appError = fromPgError(err)!;
  } else if (err instanceof SyntaxError && 'body' in err) {
    appError = AppError.badRequest('Malformed JSON body');
  } else if (typeof err === 'object' && err && (err as { type?: string }).type === 'entity.too.large') {
    appError = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  } else {
    appError = new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }

  const logPayload = { err, requestId: req.requestId, userId: req.user?.id, path: req.originalUrl };
  if (appError.statusCode >= 500) logger.error(logPayload, 'Unhandled error');
  else logger.warn({ ...logPayload, err: undefined, code: appError.code, message: appError.message }, 'Request rejected');

  res.status(appError.statusCode).json({
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined ? { details: appError.details } : {}),
      requestId: req.requestId,
      ...(!isProduction && appError.statusCode >= 500 && err instanceof Error ? { stack: err.stack } : {}),
    },
  });
}
