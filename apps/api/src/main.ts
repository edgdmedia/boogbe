import { buildApp } from './build-app';
import { loadEnv } from './env';

async function main() {
  const env = loadEnv();
  const app = await buildApp();
  app.enableShutdownHooks();
  await app.listen(env.PORT, '127.0.0.1');
}
void main();
