import { Controller, Get, Inject, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/auth/decorators';
import { MAILER } from '../../common/mail/mail.module';
import type { MemoryMailer } from '../../common/mail/mailer';
import { ListingPhotosJob } from '../website/listing-photos.job';

/** E2E/test only: lets Playwright read the emails the API "sent". Never registered in production. */
@Controller('__test')
export class TestSupportController {
  constructor(
    @Inject(MAILER) private readonly mailer: MemoryMailer,
    private readonly photos: ListingPhotosJob,
  ) {}

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

  /** Run one resize-job pass on the spot (the cron only lives in the worker process, D-019). */
  @Post('run-photos')
  @Public()
  async runPhotos() {
    await this.photos.run();
    return { ok: true };
  }
}
