import pino from 'pino';
import { env, isProduction } from './env';

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : isProduction ? 'info' : 'debug',
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.password_hash', '*.token'],
    censor: '[REDACTED]',
  },
  ...(isProduction ? {} : { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:standard' } } }),
});
