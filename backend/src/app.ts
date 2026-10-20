import compression from 'compression';
import express from 'express';
import { pinoHttp } from 'pino-http';
import { checkDatabaseConnection } from './config/database';
import { env } from './config/env';
import { logger } from './config/logger';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import { apiRateLimiter, corsMiddleware, helmetMiddleware, requestId } from './middlewares/security';
import api from './routes';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestId);
  app.use(helmetMiddleware);
  app.use(corsMiddleware);
  app.use(pinoHttp({ logger, genReqId: (req) => (req as express.Request).requestId, autoLogging: { ignore: (req) => req.url === '/health' } }));
  app.use(compression({ filter: (req, res) => !req.path.endsWith('/stream') && compression.filter(req, res) }));
  app.use(express.json({ limit: '200kb' }));

  app.get('/', (_req, res) => {
    res.json({
      name: 'Dar Al Dhiafa IMS & HACCP API',
      nameAr: 'واجهة برمجة منصة دار الضيافة لسلامة الغذاء',
      version: process.env.npm_package_version ?? '1.0.0',
      status: 'running',
      endpoints: { health: '/health', api: '/api/v1', login: 'POST /api/v1/auth/login' },
    });
  });

  app.get('/health', async (_req, res) => {
    try {
      await checkDatabaseConnection();
      res.json({ status: 'ok', database: 'up', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'down' });
    }
  });

  app.use('/api/v1', apiRateLimiter, api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
