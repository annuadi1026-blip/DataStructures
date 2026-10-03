// Applies migrations to the TEST database before vitest runs.
import '../src/config/env.js';
process.env.NODE_ENV = 'test';
const { migrate } = await import('./migrate.js');
const { closePool } = await import('../src/config/db.js');
if (!process.env.TEST_DATABASE_URL) {
  console.error('Set TEST_DATABASE_URL to a throw-away PostgreSQL database before running tests.');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { env } = await import('../src/config/env.js');
env.DATABASE_URL = process.env.TEST_DATABASE_URL;
env.JWT_SECRET = env.JWT_SECRET || 'test-secret-test-secret-test-secret-123';
await migrate({ quiet: true });
await closePool();
console.log('Test database migrated');
