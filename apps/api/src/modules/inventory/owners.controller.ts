import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { createZodDto } from 'nestjs-zod';
import { OwnerInput } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { OwnersService } from './owners.service';

class OwnerDto extends createZodDto(OwnerInput) {}
class OwnerPatchDto extends createZodDto(OwnerInput.partial()) {}

@Controller('owners')
export class OwnersController {
  constructor(private readonly svc: OwnersService) {}

  @Get()
  @Permission('owners.read')
  async list(@Ctx() c: RequestCtx, @Query('includeArchived') a?: string) {
    return { items: await this.svc.list(requireOrg(c), a === 'true') };
  }

  @Post()
  @Permission('owners.write')
  create(@Ctx() c: RequestCtx, @Body() b: OwnerDto) {
    return this.svc.create(requireOrg(c), b);
  }

  @Patch(':id')
  @Permission('owners.write')
  update(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: OwnerPatchDto) {
    return this.svc.update(requireOrg(c), id, b);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @Permission('owners.write')
  archive(@Ctx() c: RequestCtx, @Param('id') id: string) {
    return this.svc.archive(requireOrg(c), id);
  }

  @Post(':id/invite')
  @HttpCode(200)
  @Permission('owners.write')
  invite(@Ctx() c: RequestCtx, @Param('id') id: string, @Req() req: Request) {
    return this.svc.invite(requireOrg(c), id, req.headers);
  }
}
