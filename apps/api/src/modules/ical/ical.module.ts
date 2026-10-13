import { Global, Module } from '@nestjs/common';
import { FeedsController } from './feeds.controller';
import { FeedsService } from './feeds.service';
import { IcalFetcher } from './fetcher';
import { IcalSyncService } from './sync.service';
import { ICAL_FETCHER } from './tokens';

@Global()
@Module({
  controllers: [FeedsController],
  providers: [FeedsService, IcalSyncService, { provide: ICAL_FETCHER, useFactory: () => new IcalFetcher() }],
  exports: [IcalSyncService, ICAL_FETCHER],
})
export class IcalModule {}
