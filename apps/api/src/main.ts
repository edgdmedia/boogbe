import { resolve } from 'node:path';
import { buildApp } from './build-app';
import { loadDotEnv, loadEnv } from './env';

async function main() {
  loadDotEnv(resolve(__dirname, '../../../.env'));
  const env = loadEnv();
  const app = await buildApp();
  app.enableShutdownHooks();
  await app.listen(env.PORT, '127.0.0.1');
}
void main();
