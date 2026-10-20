import { Module } from '@nestjs/common';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { ListingPhotosController } from './listing-photos.controller';
import { ListingPhotosService } from './listing-photos.service';

@Module({
  controllers: [ListingsController, ListingPhotosController],
  providers: [ListingsService, ListingPhotosService],
  exports: [ListingsService, ListingPhotosService],
})
export class WebsiteModule {}
