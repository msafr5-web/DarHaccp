import { Router } from 'express';
import * as auth from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth';
import { authRateLimiter } from '../middlewares/security';
import { validate } from '../middlewares/validate';

const router = Router();

// Two-step sign-in: company code + e-mail + password, then the e-mailed one-time code.
router.post('/login', authRateLimiter, validate({ body: auth.loginSchema }), auth.login);
router.post('/verify-otp', authRateLimiter, validate({ body: auth.verifyOtpSchema }), auth.verifyOtp);
router.post('/resend-otp', authRateLimiter, validate({ body: auth.resendOtpSchema }), auth.resendOtp);
router.post('/activate', authRateLimiter, validate({ body: auth.activateSchema }), auth.activate);
router.post('/forgot-password', authRateLimiter, validate({ body: auth.forgotPasswordSchema }), auth.forgotPassword);

router.get('/me', authenticate, auth.me);
router.post('/change-password', authenticate, authRateLimiter, validate({ body: auth.changePasswordSchema }), auth.changePassword);
router.put('/push-token', authenticate, validate({ body: auth.pushTokenSchema }), auth.updatePushToken);

export default router;
