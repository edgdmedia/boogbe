import { Module } from '@nestjs/common';
import { JobsModule } from '../../common/jobs/jobs.module';
import { ListingPhotosJob } from '../website/listing-photos.job';
import { TestSupportController } from './test-support.controller';

@Module({ imports: [JobsModule], controllers: [TestSupportController], providers: [ListingPhotosJob] })
export class TestSupportModule {}
