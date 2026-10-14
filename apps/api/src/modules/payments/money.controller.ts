import { Controller, Get, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { MoneyQuery } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { MoneyService } from './money.service';

class Q extends createZodDto(MoneyQuery) {}

@Controller('money')
export class MoneyController {
  constructor(private readonly svc: MoneyService) {}

  @Get('summary')
  @Permission('payments.read')
  summary(@Ctx() c: RequestCtx, @Query() q: Q) {
    return this.svc.summary(requireOrg(c), q);
  }
}
