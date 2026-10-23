import { Router } from 'express';
import * as forms from '../controllers/catalog.controller';
import * as guide from '../controllers/healthGuide.controller';
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
platformRoutes.patch('/tenants/:id', validate({ params: tenants.tenantIdParams, body: tenants.tenantUpdateSchema }), tenants.updateDetails);
platformRoutes.post('/tenants/:id/approve', validate({ params: tenants.tenantIdParams, body: tenants.reviewSchema }), tenants.approve);
platformRoutes.post('/tenants/:id/reject', validate({ params: tenants.tenantIdParams, body: tenants.reasonSchema }), tenants.reject);
platformRoutes.post('/tenants/:id/suspend', validate({ params: tenants.tenantIdParams, body: tenants.reasonSchema }), tenants.suspend);
platformRoutes.post('/tenants/:id/reactivate', validate({ params: tenants.tenantIdParams }), tenants.reactivate);
platformRoutes.post('/tenants/:id/reopen', validate({ params: tenants.tenantIdParams, body: tenants.reviewSchema }), tenants.reopen);
platformRoutes.post('/tenants/:id/resend-activation', validate({ params: tenants.tenantIdParams }), tenants.resendActivationLink);
// Health certificate guide (reference content shared by every company).
platformRoutes.get('/health-guide', guide.getGuideAdmin);
platformRoutes.patch('/health-guide/:kind/:id', validate({ params: guide.guideItemParams }), guide.updateItem);
platformRoutes.get('/login-attempts', validate({ query: tenants.attemptsQuery }), tenants.platformAttempts);

// Form library (add / remove fields) and the forms enabled for each company.
platformRoutes.get('/catalog', forms.list);
platformRoutes.post('/catalog', validate({ body: forms.catalogCreateSchema }), forms.create);
platformRoutes.get('/catalog/:id', validate({ params: forms.catalogIdParams }), forms.get);
platformRoutes.patch('/catalog/:id', validate({ params: forms.catalogIdParams, body: forms.catalogUpdateSchema }), forms.update);
platformRoutes.get('/tenants/:id/forms', validate({ params: tenants.tenantIdParams }), forms.tenantForms);
platformRoutes.get('/tenants/:id/forms/:catalogId', validate({ params: forms.tenantFormParams }), forms.tenantForm);
platformRoutes.post('/tenants/:id/forms/:catalogId/enable', validate({ params: forms.tenantFormParams }), forms.enable);
platformRoutes.post('/tenants/:id/forms/:catalogId/disable', validate({ params: forms.tenantFormParams }), forms.disable);
platformRoutes.put('/tenants/:id/forms/:catalogId/fields', validate({ params: forms.tenantFormParams, body: forms.tenantFieldsSchema }), forms.customize);
platformRoutes.post('/tenants/:id/forms/:catalogId/reset', validate({ params: forms.tenantFormParams }), forms.reset);

/** Company-level account & security endpoints. */
export const companyRoutes = Router();
companyRoutes.get('/company', tenants.myCompany);
companyRoutes.get('/security/login-attempts', authorize('user:manage'), validate({ query: tenants.attemptsQuery }), tenants.companyAttempts);
