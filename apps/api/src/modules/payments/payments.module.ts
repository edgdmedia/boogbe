import { Global, Module } from '@nestjs/common';
import { PaymentsController, ReceiptsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentHooks } from './payment-hooks';
import { MoneyController } from './money.controller';
import { MoneyService } from './money.service';

@Global()
@Module({
  controllers: [PaymentsController, ReceiptsController, MoneyController],
  providers: [PaymentsService, PaymentHooks, MoneyService],
  exports: [PaymentsService, PaymentHooks],
})
export class PaymentsModule {}
