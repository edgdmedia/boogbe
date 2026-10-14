import type { RequestHandler } from 'express';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * better-auth does not hard-403 untrusted origins, so a cross-site HTML form POST reaches
 * express with form-urlencoded/multipart/text/plain. JSON APIs never accept those: refuse
 * any *present* non-JSON content type on mutating /v1 routes. A missing content type (an
 * intentionally bodiless POST like suspend/reactivate) stays allowed — a browser form can
 * only send with a content type, so the gate still holds.
 */
export const jsonOnly: RequestHandler = (req, res, next) => {
  if (!MUTATING.has(req.method)) return next();
  if (req.path.startsWith('/v1/auth')) return next(); // better-auth parses its own body
  const ct = req.headers['content-type'];
  if (ct !== undefined && !ct.toLowerCase().startsWith('application/json')) {
    res.status(415).json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Send JSON (Content-Type: application/json)' } });
    return;
  }
  next();
};
