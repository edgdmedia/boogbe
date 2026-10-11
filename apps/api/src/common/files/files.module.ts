import { Global, Module } from '@nestjs/common';
import { loadEnv } from '../../env';
import { FilesService } from './files.service';
import { MemoryStorage, R2Storage, STORAGE } from './storage';

@Global()
@Module({
  providers: [
    {
      provide: STORAGE,
      useFactory: () => {
        const e = loadEnv();
        return e.R2_ENDPOINT && e.NODE_ENV !== 'test'
          ? new R2Storage(e.R2_ENDPOINT, e.R2_BUCKET!, e.R2_ACCESS_KEY_ID!, e.R2_SECRET_ACCESS_KEY!)
          : new MemoryStorage();
      },
    },
    FilesService,
  ],
  exports: [STORAGE, FilesService],
})
export class FilesModule {}
