import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AuditModule } from './common/audit/audit.module';
import { AuthModule } from './common/auth/auth.module';
import { SessionGuard } from './common/auth/session.guard';
import { DbModule } from './common/db/db.module';
import { ErrorFilter } from './common/http/error.filter';
import { MailModule } from './common/mail/mail.module';
import { HealthController } from './modules/health/health.controller';
import { MeModule } from './modules/me/me.module';

@Module({
  imports: [DbModule, MailModule, AuthModule, AuditModule, MeModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
export class AppModule {}
