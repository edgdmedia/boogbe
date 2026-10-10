import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';
import { AuditModule } from './common/audit/audit.module';
import { AuthModule } from './common/auth/auth.module';
import { SessionGuard } from './common/auth/session.guard';
import { DbModule } from './common/db/db.module';
import { ErrorFilter } from './common/http/error.filter';
import { MailModule } from './common/mail/mail.module';
import { HealthController } from './modules/health/health.controller';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { MeModule } from './modules/me/me.module';
import { OrgModule } from './modules/org/org.module';
import { PlatformModule } from './modules/platform/platform.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 10_000 : 120 }]),
    DbModule,
    MailModule,
    AuthModule,
    AuditModule,
    MeModule,
    PlatformModule,
    InvitationsModule,
    OrgModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    // Order matters: rate limiting runs before session resolution.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
export class AppModule {}
