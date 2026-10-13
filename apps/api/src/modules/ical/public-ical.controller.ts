import { Controller, Get, Param, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/auth/decorators';
import { notFound } from '../../common/http/app-error';
import { ExportsService } from './exports.service';

/** `GET /v1/ical/<token>.ics`, polled by Airbnb/Booking.com (ICS-04). Registered last so `ical/feeds` etc. match first. */
@Controller('ical')
export class PublicIcalController {
  constructor(private readonly svc: ExportsService) {}

  @Get(':file')
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async ics(@Param('file') file: string, @Res() res: Response) {
    const body = file.endsWith('.ics') ? await this.svc.render(file.slice(0, -4)) : null;
    if (!body) throw notFound('Calendar');
    res.setHeader('content-type', 'text/calendar; charset=utf-8');
    res.setHeader('cache-control', 'public, max-age=300');
    res.send(body);
  }
}
