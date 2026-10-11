import { Global, Module } from '@nestjs/common';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { CalendarSources } from './calendar-sources';

@Global()
@Module({
  controllers: [CalendarController],
  providers: [CalendarService, CalendarSources],
  exports: [CalendarSources],
})
export class CalendarModule {}
