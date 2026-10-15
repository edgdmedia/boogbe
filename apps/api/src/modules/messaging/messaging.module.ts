import { Global, Module } from '@nestjs/common';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';
import { VarsService } from './vars.service';

@Global()
@Module({
  controllers: [TemplatesController],
  providers: [TemplatesService, VarsService],
  exports: [TemplatesService, VarsService],
})
export class MessagingModule {}
