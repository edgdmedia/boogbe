import { Global, Module } from '@nestjs/common';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { FeedsController } from './feeds.controller';
import { FeedsService } from './feeds.service';
import { IcalFetcher } from './fetcher';
import { PublicIcalController } from './public-ical.controller';
import { IcalSyncService } from './sync.service';
import { ICAL_FETCHER } from './tokens';

@Global()
@Module({
  // PublicIcalController (`ical/:file`) must stay last so the specific `ical/...` routes match first.
  controllers: [FeedsController, ExportsController, PublicIcalController],
  providers: [FeedsService, ExportsService, IcalSyncService, { provide: ICAL_FETCHER, useFactory: () => new IcalFetcher() }],
  exports: [IcalSyncService, ICAL_FETCHER],
})
export class IcalModule {}
