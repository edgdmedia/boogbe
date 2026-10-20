import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import type { z } from 'zod';
import { AvailabilityQuery, BookingRequestInput, PublicQuoteQuery } from '@boogbe/shared';
import { PublicRequestsService } from './public-requests.service';
import { PublicSiteService } from './public-site.service';
import { Public } from '../../common/auth/decorators';
import { AppError } from '../../common/http/app-error';
import { invalidDates, PublicReadService } from './public-read.service';
import { PublicOrgService } from './public-org.service';

/**
 * Queries and the request body are parsed here rather than by the global pipe: the widget only needs to tell date problems
 * (INVALID_DATES) apart from everything else, and the generic VALIDATION_FAILED shape would hide that.
 */
const DATE_FIELDS = new Set(['from', 'to', 'checkIn', 'checkOut']);
function parseDates<S extends z.ZodTypeAny>(schema: S, q: unknown): z.infer<S> {
  const r = schema.safeParse(q);
  if (r.success) return r.data;
  const dates = r.error.issues.filter((i) => DATE_FIELDS.has(String(i.path[0])));
  if (dates.length) throw invalidDates(dates[0]!.message);
  throw new AppError('VALIDATION_FAILED', 400, 'Check the request', r.error.issues);
}

@Controller('public/:slug')
export class PublicController {
  constructor(
    private readonly orgs: PublicOrgService,
    private readonly read: PublicReadService,
    private readonly requests: PublicRequestsService,
    private readonly site: PublicSiteService,
  ) {}

  // Website listings (WL): the version probe is cheap and edge-cached 15 s; the payload is
  // immutable per version, and a missing or stale `v` is bounced to the current one (plan §5.6).
  @Get('site/version')
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async siteVersion(@Param('slug') slug: string, @Res() res: Response) {
    const org = await this.orgs.resolveSite(slug);
    const version = await this.site.version(org.orgId);
    res.setHeader('Cache-Control', 'public, max-age=15');
    return res.json({ version });
  }

  @Get('site')
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async sitePayload(@Param('slug') slug: string, @Query('v') v: unknown, @Res() res: Response) {
    const org = await this.orgs.resolveSite(slug);
    const current = await this.site.version(org.orgId);
    if (Number(v) !== current) {
      // no-store on the bounce, so a cache never keeps the redirect itself for a year.
      res.setHeader('Cache-Control', 'no-store');
      return res.redirect(302, `/v1/public/${slug.toLowerCase()}/site?v=${current}`);
    }
    const payload = await this.site.payload(org, slug.toLowerCase());
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.json(payload);
  }

  @Get('units')
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async units(@Param('slug') slug: string) {
    return this.read.units(await this.orgs.resolve(slug));
  }

  @Get('units/:unitId/availability')
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async availability(@Param('slug') slug: string, @Param('unitId') unitId: string, @Query() q: unknown) {
    const org = await this.orgs.resolve(slug);
    const { from, to } = parseDates(AvailabilityQuery, q);
    return this.read.availability(org, unitId, from, to);
  }

  @Get('units/:unitId/quote')
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async quote(@Param('slug') slug: string, @Param('unitId') unitId: string, @Query() q: unknown) {
    const org = await this.orgs.resolve(slug);
    const { checkIn, checkOut, guests } = parseDates(PublicQuoteQuery, q);
    return this.read.quote(org, unitId, checkIn, checkOut, guests);
  }

  @Post('requests')
  @Public()
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  async request(@Param('slug') slug: string, @Body() body: unknown, @Req() req: Request) {
    await this.orgs.resolve(slug); // an unknown or switched-off operator is UNAVAILABLE before any validation detail
    return this.requests.create(slug, parseDates(BookingRequestInput, body), req.ip);
  }
}
