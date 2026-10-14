import { Module } from '@nestjs/common';
import { TestSupportController } from './test-support.controller';

@Module({ controllers: [TestSupportController] })
export class TestSupportModule {}
