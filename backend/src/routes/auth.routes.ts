import { Router } from 'express';
import * as auth from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth';
import { authRateLimiter } from '../middlewares/security';
import { validate } from '../middlewares/validate';

const router = Router();

// Password-less sign-in: e-mail -> one message with a login link and a 6-digit code.
router.post('/login', authRateLimiter, validate({ body: auth.loginSchema }), auth.login);
router.post('/magic-link', authRateLimiter, validate({ body: auth.magicLinkSchema }), auth.verifyMagicLinkLogin);
router.post('/verify-otp', authRateLimiter, validate({ body: auth.verifyOtpSchema }), auth.verifyOtp);
router.post('/resend-otp', authRateLimiter, validate({ body: auth.resendOtpSchema }), auth.resendOtp);
router.post('/activate', authRateLimiter, validate({ body: auth.activateSchema }), auth.activate);
router.post('/login-link', authRateLimiter, validate({ body: auth.loginLinkSchema }), auth.sendLoginLink);
router.post('/forgot-password', authRateLimiter, validate({ body: auth.forgotPasswordSchema }), auth.forgotPassword);

router.get('/me', authenticate, auth.me);
router.post('/change-password', authenticate, authRateLimiter, validate({ body: auth.changePasswordSchema }), auth.changePassword);
router.put('/push-token', authenticate, validate({ body: auth.pushTokenSchema }), auth.updatePushToken);

export default router;
