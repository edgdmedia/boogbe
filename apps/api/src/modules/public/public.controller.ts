import { Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { z } from 'zod';
import { AvailabilityQuery, PublicQuoteQuery } from '@boogbe/shared';
import { Public } from '../../common/auth/decorators';
import { AppError } from '../../common/http/app-error';
import { invalidDates, PublicReadService } from './public-read.service';
import { PublicOrgService } from './public-org.service';

/**
 * Query strings are parsed here rather than by the global pipe: the widget only needs to tell date problems
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
  ) {}

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
}
