import { env, assertConfig } from './config/env.js';
import { closePool } from './config/db.js';
import { createApp } from './app.js';

assertConfig();
const app = createApp();
const server = app.listen(env.PORT, () => console.log(`DSA Squad API listening on :${env.PORT} (${env.NODE_ENV})`));

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => { await closePool(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
