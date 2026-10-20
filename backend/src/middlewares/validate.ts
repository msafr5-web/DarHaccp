import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/** Validates request parts with Zod; parsed values are exposed on `req.valid`. ZodErrors reach the error handler. */
export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.valid ??= {};
    if (schemas.params) req.valid.params = schemas.params.parse(req.params);
    if (schemas.query) req.valid.query = schemas.query.parse(req.query);
    if (schemas.body) req.valid.body = schemas.body.parse(req.body ?? {});
    next();
  };
}
