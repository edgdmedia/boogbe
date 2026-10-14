import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { resolve } from 'node:path';
import { loadDotEnv, loadEnv } from './env';

async function main() {
  loadDotEnv(resolve(__dirname, '../../../.env'));
  loadEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
}
void main();
