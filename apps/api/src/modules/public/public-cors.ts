import type { NextFunction, Request, Response } from 'express';
import type { PublicOrgService } from './public-org.service';

/**
 * CORS for `/v1/public/:slug/*`: reflects `Origin` only when it is in that org's `public_origins` (exact match),
 * never with credentials. Mounted before the app-wide CORS, which then skips these routes, so APP_ORIGIN gets no
 * pass here and public routes never carry `Access-Control-Allow-Credentials`.
 */
export function publicCors(orgs: PublicOrgService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    (req as Request & { publicRoute?: boolean }).publicRoute = true;
    res.setHeader('Vary', 'Origin');
    const parts = req.path.split('/'); // mounted under /v1/public → ['', '<slug>', '<route>', …]
    const slug = parts[1];
    const origin = req.headers.origin;
    const org = slug && origin ? await orgs.find(slug).catch(() => null) : null;
    // WL: GET /site and /site/version answer for any ACTIVE org, so their origins come from the
    // site lookup when the booking lookup is off. Other routes keep WB's rule exactly.
    const isSiteRoute = parts[2] === 'site' && req.method === 'GET';
    const origins = org ? org.origins : !org && isSiteRoute && slug && origin ? await orgs.siteOrigins(slug) : [];
    const allowed = !!origin && origins.includes(origin);
    if (allowed) res.setHeader('Access-Control-Allow-Origin', origin);
    if (req.method === 'OPTIONS') {
      if (allowed) {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
        res.setHeader('Access-Control-Allow-Headers', 'content-type');
        res.setHeader('Access-Control-Max-Age', '600');
      }
      return res.status(204).end();
    }
    next();
  };
}
