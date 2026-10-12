import { Global, Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { GuestsModule } from '../guests/guests.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BookingHooks } from './booking-hooks';
import { BookingSourceImpl } from './booking-source';

@Global()
@Module({
  imports: [InventoryModule, GuestsModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingHooks, BookingSourceImpl],
  exports: [BookingsService, BookingHooks],
})
export class BookingsModule {}
