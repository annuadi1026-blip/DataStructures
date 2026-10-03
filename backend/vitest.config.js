import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '../.env' });

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false, // all files share one throw-away test database
    testTimeout: 20000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL || '',
      JWT_SECRET: 'test-secret-test-secret-test-secret-123',
      CRON_SECRET: 'test-cron-secret',
      FRONTEND_URL: 'http://localhost:5173',
    },
  },
});
