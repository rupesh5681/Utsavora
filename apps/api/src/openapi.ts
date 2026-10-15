/* Writes docs/openapi.json without needing a running server's network port. */
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createApp, buildOpenApi } from './app.factory';
import { loadConfig } from './config';

async function main() {
  const app = await createApp({ ...loadConfig({ ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'Server=localhost;Database=unused;User Id=unused;Password=unused' }), outboxIntervalMs: 0 }, { logger: false });
  await app.init();
  const out = path.resolve(__dirname, '../../../docs/openapi.json');
  writeFileSync(out, JSON.stringify(buildOpenApi(app), null, 2));
  await app.close();
  console.log(`Wrote ${out}`);
}
void main();
