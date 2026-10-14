import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  @Permission('notifications.read')
  list(@Ctx() c: RequestCtx) {
    return this.svc.list(requireOrg(c));
  }

  @Post('read-all')
  @HttpCode(200)
  @Permission('notifications.read')
  all(@Ctx() c: RequestCtx) {
    return this.svc.markAllRead(requireOrg(c));
  }

  @Post(':id/read')
  @HttpCode(200)
  @Permission('notifications.read')
  read(@Ctx() c: RequestCtx, @Param('id') id: string) {
    return this.svc.markRead(requireOrg(c), id);
  }
}
