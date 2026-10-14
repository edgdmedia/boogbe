import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { BlockInput, BlockReason, IsoDateSchema } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { BlocksService } from './blocks.service';

class BlockDto extends createZodDto(BlockInput) {}
class BlockPatchDto extends createZodDto(
  z
    .object({
      start: IsoDateSchema.optional(),
      end: IsoDateSchema.optional(),
      reason: BlockReason.optional(),
      note: z.string().max(500).nullable().optional(),
    })
    .strict(),
) {}

@Controller('blocks')
export class BlocksController {
  constructor(private readonly svc: BlocksService) {}

  @Post()
  @Permission('bookings.write')
  create(@Ctx() c: RequestCtx, @Body() b: BlockDto) {
    return this.svc.create(requireOrg(c), b);
  }

  @Patch(':id')
  @Permission('bookings.write')
  update(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: BlockPatchDto) {
    return this.svc.update(requireOrg(c), id, b);
  }

  @Delete(':id')
  @Permission('bookings.write')
  remove(@Ctx() c: RequestCtx, @Param('id') id: string) {
    return this.svc.remove(requireOrg(c), id);
  }
}
