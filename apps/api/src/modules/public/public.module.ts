import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { PublicController } from './public.controller';
import { PublicOrgService } from './public-org.service';
import { PublicReadService } from './public-read.service';

/** Unauthenticated, per-operator online booking API under `/v1/public/:slug` (WB). Off unless `public_enabled`. */
@Module({
  imports: [BookingsModule],
  controllers: [PublicController],
  providers: [PublicOrgService, PublicReadService],
  exports: [PublicOrgService, PublicReadService],
})
export class PublicModule {}
