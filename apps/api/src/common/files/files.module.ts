import { Global, Module } from '@nestjs/common';
import { loadEnv } from '../../env';
import { FilesService } from './files.service';
import { MemoryStorage, MEDIA_STORAGE, PrefixedStorage, R2Storage, STORAGE } from './storage';

@Global()
@Module({
  providers: [
    {
      provide: STORAGE,
      useFactory: () => {
        const e = loadEnv();
        return e.R2_ENDPOINT && e.NODE_ENV !== 'test'
          ? new R2Storage(e.R2_ENDPOINT, e.R2_BUCKET!, e.R2_ACCESS_KEY_ID!, e.R2_SECRET_ACCESS_KEY!)
          : new MemoryStorage(process.env.E2E === '1' ? e.API_PUBLIC_ORIGIN : undefined);
      },
    },
    {
      // The public media bucket (listing-photo variants, WL). Dev and test share one in-memory store
      // under a media/ prefix; production writes the R2 bucket behind media.boogbe.com.
      provide: MEDIA_STORAGE,
      useFactory: () => {
        const e = loadEnv();
        return e.R2_ENDPOINT && e.MEDIA_R2_BUCKET && e.NODE_ENV !== 'test'
          ? new R2Storage(e.R2_ENDPOINT, e.MEDIA_R2_BUCKET, e.R2_ACCESS_KEY_ID!, e.R2_SECRET_ACCESS_KEY!)
          : new PrefixedStorage(new MemoryStorage(), 'media/');
      },
    },
    FilesService,
  ],
  exports: [STORAGE, MEDIA_STORAGE, FilesService],
})
export class FilesModule {}
