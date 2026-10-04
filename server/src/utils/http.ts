import type { Response } from 'express';
import type { z } from 'zod';

/** Validates input against a Zod schema; a ZodError becomes a 400 in the error handler. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  return schema.parse(data);
}

export function ok(res: Response, data: unknown, status = 200) {
  return res.status(status).json({ success: true, data });
}

export function paginated(
  res: Response,
  result: { rows: unknown[]; total: number; [key: string]: unknown },
  page: number,
  pageSize: number,
) {
  const { rows, total, ...extra } = result;
  return res.json({
    success: true,
    data: rows,
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), ...extra },
  });
}
