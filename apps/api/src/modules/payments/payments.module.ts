import { Global, Module } from '@nestjs/common';
import { PaymentsController, ReceiptsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentHooks } from './payment-hooks';

@Global()
@Module({
  controllers: [PaymentsController, ReceiptsController],
  providers: [PaymentsService, PaymentHooks],
  exports: [PaymentsService, PaymentHooks],
})
export class PaymentsModule {}
