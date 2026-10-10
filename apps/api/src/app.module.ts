import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AuthModule } from './common/auth/auth.module';
import { DbModule } from './common/db/db.module';
import { ErrorFilter } from './common/http/error.filter';
import { MailModule } from './common/mail/mail.module';
import { HealthController } from './modules/health/health.controller';

@Module({
  imports: [DbModule, MailModule, AuthModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
export class AppModule {}
