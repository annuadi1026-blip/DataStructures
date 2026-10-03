import rateLimit from 'express-rate-limit';
import { isTest } from '../config/env.js';

const handler = (req, res) =>
  res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down' } });

const make = (windowMs, limit) =>
  rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, handler, skip: () => isTest });

export const apiLimiter = make(60 * 1000, 300);
export const authLimiter = make(15 * 60 * 1000, 30);
