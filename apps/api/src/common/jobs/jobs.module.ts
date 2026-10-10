import { Global, Module } from '@nestjs/common';
import { JobRunner } from './job-runner';

@Global()
@Module({ providers: [JobRunner], exports: [JobRunner] })
export class JobsModule {}
