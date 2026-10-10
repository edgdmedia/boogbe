import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditModule } from './common/audit/audit.module';
import { AuthModule } from './common/auth/auth.module';
import { DbModule } from './common/db/db.module';
import { JobsModule } from './common/jobs/jobs.module';
import { MailModule } from './common/mail/mail.module';

/** Cron jobs only. Later milestones add their *.jobs.ts providers here. */
@Module({
  imports: [ScheduleModule.forRoot(), DbModule, MailModule, AuthModule, AuditModule, JobsModule],
  providers: [],
})
export class WorkerModule {}
