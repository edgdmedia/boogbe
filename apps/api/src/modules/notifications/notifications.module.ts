import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { AlertMailer } from './alert-mailer';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, AlertMailer],
  exports: [NotificationsService],
})
export class NotificationsModule {}
