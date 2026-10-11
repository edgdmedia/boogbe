import { Controller, Get, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { CalendarQuery } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { CalendarService } from './calendar.service';

class Q extends createZodDto(CalendarQuery) {}

@Controller('calendar')
export class CalendarController {
  constructor(private readonly svc: CalendarService) {}

  @Get()
  @Permission('calendar.read')
  get(@Ctx() c: RequestCtx, @Query() q: Q) {
    return this.svc.get(requireOrg(c), q);
  }
}
