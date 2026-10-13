import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { loadConfig } from './config';
import { createApp } from './app.factory';

async function bootstrap() {
  try {
    process.loadEnvFile?.('.env');
  } catch {
    /* rely on real environment variables */
  }
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen(config.port, '0.0.0.0');
  Logger.log(`Utsavora API listening on :${config.port} (docs at /v1/docs)`, 'Bootstrap');
}

void bootstrap();
