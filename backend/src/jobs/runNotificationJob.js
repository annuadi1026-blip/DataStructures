// CLI entry for cron-style hosts:  npm run job:notifications
import { fileURLToPath } from 'node:url';
import { assertConfig } from '../config/env.js';
import { closePool } from '../config/db.js';
import { processScheduled } from '../services/notificationService.js';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    assertConfig();
    const stats = await processScheduled();
    console.log('Notification job finished', JSON.stringify(stats));
    await closePool();
  } catch (e) {
    console.error('Notification job failed:', e.message);
    process.exit(1);
  }
}
