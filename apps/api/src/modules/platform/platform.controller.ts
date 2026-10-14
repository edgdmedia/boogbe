import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { CreateOperatorInput, InviteFirstAdminInput } from '@boogbe/shared';
import { Ctx, PlatformAdmin } from '../../common/auth/decorators';
import type { RequestCtx } from '../../common/auth/request-ctx';
import { PlatformService } from './platform.service';

class CreateOperatorDto extends createZodDto(CreateOperatorInput) {}
class InviteDto extends createZodDto(InviteFirstAdminInput) {}

@Controller('platform')
@PlatformAdmin()
export class PlatformController {
  constructor(private readonly svc: PlatformService) {}

  @Get('operators')
  async list() {
    return { items: await this.svc.list() };
  }

  @Post('operators')
  create(@Body() b: CreateOperatorDto, @Ctx() c: RequestCtx) {
    return this.svc.createOperator(b, c.userId);
  }

  @Get('operators/:id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post('operators/:id/suspend')
  @HttpCode(200)
  suspend(@Param('id') id: string, @Ctx() c: RequestCtx) {
    return this.svc.setStatus(id, 'suspended', c.userId);
  }

  @Post('operators/:id/reactivate')
  @HttpCode(200)
  reactivate(@Param('id') id: string, @Ctx() c: RequestCtx) {
    return this.svc.setStatus(id, 'active', c.userId);
  }

  @Post('operators/:id/invite-admin')
  invite(@Param('id') id: string, @Body() b: InviteDto, @Ctx() c: RequestCtx) {
    return this.svc.inviteAdmin(id, b.email, c.userId);
  }

  @Post('invitations/:id/resend')
  @HttpCode(200)
  resend(@Param('id') id: string) {
    return this.svc.resend(id);
  }

  @Post('invitations/:id/revoke')
  @HttpCode(200)
  revoke(@Param('id') id: string) {
    return this.svc.revoke(id);
  }
}
