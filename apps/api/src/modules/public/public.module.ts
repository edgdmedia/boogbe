import { Module } from '@nestjs/common';
import { loadEnv } from '../../env';
import { BookingsModule } from '../bookings/bookings.module';
import { MessagingModule } from '../messaging/messaging.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PublicRequestsService } from './public-requests.service';
import { CloudflareTurnstile, TURNSTILE_VERIFIER } from './turnstile';
import { WebsiteEmailsModule } from './website-emails.service';
import { PublicController } from './public.controller';
import { PublicOrgService } from './public-org.service';
import { PublicReadService } from './public-read.service';

/** Unauthenticated, per-operator online booking API under `/v1/public/:slug` (WB). Off unless `public_enabled`. */
@Module({
  imports: [BookingsModule, MessagingModule, NotificationsModule, WebsiteEmailsModule],
  controllers: [PublicController],
  providers: [
    PublicOrgService,
    PublicReadService,
    PublicRequestsService,
    { provide: TURNSTILE_VERIFIER, useFactory: () => new CloudflareTurnstile(loadEnv().TURNSTILE_SECRET_KEY) },
  ],
  exports: [PublicOrgService, PublicReadService],
})
export class PublicModule {}
