import { Controller, Get, Inject, Query } from '@nestjs/common';
import { Public } from '../../common/auth/decorators';
import { MAILER } from '../../common/mail/mail.module';
import type { MemoryMailer } from '../../common/mail/mailer';

/** E2E only: lets Playwright read the emails the API "sent". Never registered in production. */
@Controller('__test')
export class TestSupportController {
  constructor(@Inject(MAILER) private readonly mailer: MemoryMailer) {}

  @Get('mail')
  @Public()
  mail(@Query('to') to: string) {
    return this.mailer.lastTo(to) ?? null;
  }
}
