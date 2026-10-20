import { Router } from 'express';
import * as auth from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth';
import { authRateLimiter } from '../middlewares/security';
import { validate } from '../middlewares/validate';

const router = Router();

router.post('/login', authRateLimiter, validate({ body: auth.loginSchema }), auth.login);
router.get('/me', authenticate, auth.me);
router.post('/change-password', authenticate, authRateLimiter, validate({ body: auth.changePasswordSchema }), auth.changePassword);
router.put('/push-token', authenticate, validate({ body: auth.pushTokenSchema }), auth.updatePushToken);

export default router;
