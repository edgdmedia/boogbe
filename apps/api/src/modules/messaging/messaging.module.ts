import { Global, Module } from '@nestjs/common';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';
import { VarsService } from './vars.service';
import { OutboxService } from './outbox.service';

@Global()
@Module({
  controllers: [TemplatesController],
  providers: [TemplatesService, VarsService, OutboxService],
  exports: [TemplatesService, VarsService, OutboxService],
})
export class MessagingModule {}
