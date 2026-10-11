import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/auth/decorators';
import { MAILER } from '../../common/mail/mail.module';
import type { MemoryMailer } from '../../common/mail/mailer';

/** E2E/test only: lets Playwright read the emails the API "sent". Never registered in production. */
@Controller('__test')
export class TestSupportController {
  constructor(@Inject(MAILER) private readonly mailer: MemoryMailer) {}

  @Get('mail')
  @Public()
  mail(@Query('to') to: string) {
    return this.mailer.lastTo(to) ?? null;
  }

  @Get('ip')
  @Public()
  ip(@Req() req: Request) {
    return { ip: req.ip };
  }
}
