import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { RecordEntryInput, VoidInput } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { PaymentsService } from './payments.service';

class RecordDto extends createZodDto(RecordEntryInput) {}
class VoidDto extends createZodDto(VoidInput) {}

@Controller('bookings/:id')
export class PaymentsController {
  constructor(private readonly svc: PaymentsService) {}

  @Get('ledger')
  @Permission('payments.read')
  ledger(@Ctx() c: RequestCtx, @Param('id') id: string) {
    return this.svc.ledger(requireOrg(c), id);
  }

  @Post('payments')
  @Permission('payments.write')
  record(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: RecordDto) {
    return this.svc.record(requireOrg(c), id, b);
  }

  @Post('payments/void')
  @HttpCode(200)
  @Permission('payments.void')
  void(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: VoidDto) {
    return this.svc.void(requireOrg(c), id, b);
  }
}
