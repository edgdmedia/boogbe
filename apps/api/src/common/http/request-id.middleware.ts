import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function requestId(req: Request & { id?: string }, res: Response, next: NextFunction) {
  req.id = randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
}
