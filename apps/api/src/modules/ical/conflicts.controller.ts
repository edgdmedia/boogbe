import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { ResolveConflictInput } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { AppError } from '../../common/http/app-error';
import { ConflictsService } from './conflicts.service';

class ResolveDto extends createZodDto(ResolveConflictInput) {}

@Controller('ical/conflicts')
export class ConflictsController {
  constructor(private readonly svc: ConflictsService) {}

  @Get()
  @Permission('bookings.read')
  list(@Ctx() c: RequestCtx, @Query('status') status = 'open') {
    if (status !== 'open' && status !== 'resolved') throw new AppError('VALIDATION_FAILED', 400, 'status is open or resolved');
    return this.svc.list(requireOrg(c), status);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @Permission('bookings.write')
  resolve(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: ResolveDto) {
    return this.svc.resolve(requireOrg(c), id, b);
  }
}
