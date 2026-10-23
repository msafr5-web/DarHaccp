import { Router } from 'express';
import * as tenants from '../controllers/tenant.controller';
import { authorize, authorizePlatform } from '../middlewares/auth';
import { authRateLimiter } from '../middlewares/security';
import { validate } from '../middlewares/validate';

/** Public company sign-up (no session). */
export const publicRoutes = Router();
publicRoutes.get('/company/:code', validate({ params: tenants.companyCodeParams }), tenants.companyByCode);
publicRoutes.get('/register/code-preview', validate({ query: tenants.codePreviewQuery }), tenants.previewCode);
publicRoutes.post('/register', authRateLimiter, validate({ body: tenants.registerSchema }), tenants.register);
publicRoutes.post('/register/verify', authRateLimiter, validate({ body: tenants.registrationOtpSchema }), tenants.verifyRegistration);
publicRoutes.post('/register/resend', authRateLimiter, validate({ body: tenants.registrationResendSchema }), tenants.resendRegistrationOtp);

/** SaaS operator console: company review and cross-company security log. */
export const platformRoutes = Router();
platformRoutes.use(authorizePlatform);
platformRoutes.get('/stats', tenants.platformStats);
platformRoutes.get('/tenants', validate({ query: tenants.listTenantsQuery }), tenants.listTenants);
platformRoutes.get('/tenants/:id', validate({ params: tenants.tenantIdParams }), tenants.getTenant);
platformRoutes.post('/tenants/:id/approve', validate({ params: tenants.tenantIdParams, body: tenants.reviewSchema }), tenants.approve);
platformRoutes.post('/tenants/:id/reject', validate({ params: tenants.tenantIdParams, body: tenants.reasonSchema }), tenants.reject);
platformRoutes.post('/tenants/:id/suspend', validate({ params: tenants.tenantIdParams, body: tenants.reasonSchema }), tenants.suspend);
platformRoutes.post('/tenants/:id/reactivate', validate({ params: tenants.tenantIdParams }), tenants.reactivate);
platformRoutes.post('/tenants/:id/reopen', validate({ params: tenants.tenantIdParams, body: tenants.reviewSchema }), tenants.reopen);
platformRoutes.post('/tenants/:id/resend-activation', validate({ params: tenants.tenantIdParams }), tenants.resendActivationLink);
platformRoutes.get('/login-attempts', validate({ query: tenants.attemptsQuery }), tenants.platformAttempts);

/** Company-level account & security endpoints. */
export const companyRoutes = Router();
companyRoutes.get('/company', tenants.myCompany);
companyRoutes.get('/security/login-attempts', authorize('user:manage'), validate({ query: tenants.attemptsQuery }), tenants.companyAttempts);
