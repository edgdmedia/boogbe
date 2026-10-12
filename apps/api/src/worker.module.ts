import { Module } from '@nestjs/common';
import { FilesModule } from './common/files/files.module';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditModule } from './common/audit/audit.module';
import { AuthModule } from './common/auth/auth.module';
import { DbModule } from './common/db/db.module';
import { JobsModule } from './common/jobs/jobs.module';
import { MailModule } from './common/mail/mail.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { BookingHoldsJob } from './modules/bookings/booking-holds.job';

/** Cron jobs only. Later milestones add their *.jobs.ts providers here. */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    DbModule,
    MailModule,
    AuthModule,
    AuditModule,
    FilesModule,
    JobsModule,
    CalendarModule,
    InventoryModule,
    NotificationsModule,
    BookingsModule,
  ],
  // Crons live only here (D-019): the API process never runs jobs.
  providers: [BookingHoldsJob],
})
export class WorkerModule {}
