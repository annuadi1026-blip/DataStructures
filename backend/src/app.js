import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { query } from './config/db.js';
import routes from './routes/index.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // Render terminates TLS in front of the app
  app.use(helmet());

  const allowed = env.FRONTEND_URL.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  app.use(cors({
    origin(origin, cb) {
      if (!origin || allowed.includes(origin)) return cb(null, true); // no Origin = curl/cron/server-to-server
      cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  app.get('/api/health', async (req, res) => {
    try { await query('SELECT 1'); res.json({ success: true, status: 'healthy' }); }
    catch { res.status(503).json({ success: false, status: 'unhealthy', error: { code: 'DATABASE_DOWN', message: 'Database unreachable' } }); }
  });
  app.use('/api', apiLimiter, routes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
