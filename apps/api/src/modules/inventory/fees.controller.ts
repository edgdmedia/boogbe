import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Kobo, UnitFeeInput } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { FeesService } from './fees.service';

class FeeDto extends createZodDto(UnitFeeInput) {}
class FeePatchDto extends createZodDto(
  z
    .object({
      label: z.string().trim().min(2).max(60).optional(),
      amountKobo: Kobo.optional(),
      includedGuests: z.number().int().min(0).max(50).optional(),
    })
    .strict(),
) {}

@Controller()
export class FeesController {
  constructor(private readonly svc: FeesService) {}

  @Get('units/:id/fees')
  @Permission('inventory.read')
  async list(@Ctx() c: RequestCtx, @Param('id') id: string) {
    return { items: await this.svc.list(requireOrg(c), id) };
  }

  @Post('units/:id/fees')
  @Permission('inventory.write')
  create(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: FeeDto) {
    return this.svc.create(requireOrg(c), id, b);
  }

  @Patch('fees/:id')
  @Permission('inventory.write')
  update(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: FeePatchDto) {
    return this.svc.update(requireOrg(c), id, b);
  }

  @Post('fees/:id/archive')
  @HttpCode(200)
  @Permission('inventory.write')
  archive(@Ctx() c: RequestCtx, @Param('id') id: string) {
    return this.svc.archive(requireOrg(c), id);
  }
}
