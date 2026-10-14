import { Body, Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { CancelBookingInput, RecordEntryInput, VoidInput } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { PaymentsService } from './payments.service';

class RecordDto extends createZodDto(RecordEntryInput) {}
class VoidDto extends createZodDto(VoidInput) {}
class CancelDto extends createZodDto(CancelBookingInput) {}

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

  /** Lives here, not in BookingsController: the optional refund needs PaymentsService (BookingsModule can't import it). */
  @Post('cancel')
  @HttpCode(200)
  @Permission('bookings.write')
  cancel(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: CancelDto) {
    return this.svc.cancelWithRefund(requireOrg(c), id, b);
  }
}

@Controller('payments')
export class ReceiptsController {
  constructor(private readonly svc: PaymentsService) {}

  @Get(':id/receipt.pdf')
  @Permission('payments.read')
  async receipt(@Ctx() c: RequestCtx, @Param('id') id: string, @Res() res: Response) {
    const { filename, pdf } = await this.svc.receipt(requireOrg(c), id);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  }
}
