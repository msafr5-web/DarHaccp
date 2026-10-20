import { createApp } from './app';
import { checkDatabaseConnection, pool } from './config/database';
import { env } from './config/env';
import { logger } from './config/logger';
import { startScheduler } from './services/scheduler.service';

async function bootstrap() {
  await checkDatabaseConnection();
  logger.info('PostgreSQL connection established');

  const app = createApp();
  const server = app.listen(env.PORT, () => logger.info(`Dar Al Dhiafa IMS API listening on :${env.PORT} (${env.NODE_ENV})`));
  server.keepAliveTimeout = 65_000;

  const stopScheduler = startScheduler();

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down gracefully');
    stopScheduler();
    server.close(async () => {
      await pool.end();
      logger.info('Shutdown complete');
      process.exit(0);
    });
    // Force exit if connections (e.g. SSE streams) keep the server open.
    setTimeout(() => process.exit(1), 10_000).unref();
    server.closeIdleConnections();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => logger.error({ reason }, 'Unhandled promise rejection'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — exiting');
  process.exit(1);
});

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
