import { Router } from 'express';
import * as audit from '../controllers/audit.controller';
import * as sweets from '../controllers/confectionery.controller';
import * as iot from '../controllers/iot.controller';
import * as users from '../controllers/user.controller';
import { authenticate, authorize, authorizeCron } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { runComplianceChecks } from '../services/scheduler.service';
import { checkMonitoringGaps } from '../services/monitoring.service';
import { ok } from '../utils/http';
import alertRoutes from './alert.routes';
import authRoutes from './auth.routes';
import capaRoutes from './capa.routes';
import confectioneryRoutes from './confectionery.routes';
import dashboardRoutes from './dashboard.routes';
import equipmentRoutes from './equipment.routes';
import haccpRoutes from './haccp.routes';
import healthCertificateRoutes from './healthCertificate.routes';
import hseRoutes from './hse.routes';
import kitchenRoutes from './kitchen.routes';
import qrRoutes from './qr.routes';
import qualityRoutes from './quality.routes';
import userRoutes from './user.routes';
import stockRoutes from './stock.routes';
import healthRegisterRoutes from '../controllers/healthRegister.controller';
import { companyRoutes, platformRoutes, publicRoutes } from './tenant.routes';
import { runAsSystem } from '../config/database';

const api = Router();

api.use('/auth', authRoutes);
// Company self-registration (SaaS sign-up).
api.use('/public', publicRoutes);

// Serverless deployments have no long-running scheduler: Vercel Cron calls this daily.
api.get('/internal/cron/compliance', authorizeCron, async (_req, res) => {
  ok(res, await runAsSystem(() => runComplianceChecks()));
});

// Periodic monitoring gaps (2-hourly readings): for an external scheduler calling every 10–15 minutes.
api.get('/internal/cron/monitoring', authorizeCron, async (_req, res) => {
  ok(res, await checkMonitoringGaps());
});

// Smart probes authenticate with their own device key (X-Device-Key), not a user session.
api.post('/iot/readings', validate({ body: iot.readingSchema }), iot.ingestReading);
// Printable data card opened in a new tab: protected by a short-lived signed link instead of a JWT.
api.get('/labels/:id/print', sweets.printLabel);

// Everything below requires a valid JWT.
api.use(authenticate);
api.use('/platform', platformRoutes);
api.use(companyRoutes);
api.get('/departments', users.getDepartments);
api.use('/users', userRoutes);
api.use('/haccp', haccpRoutes);
api.use('/kitchens/:department', kitchenRoutes);
api.use('/capas', capaRoutes);
api.use('/alerts', alertRoutes);
api.use('/qr', qrRoutes);
api.use('/dashboard', dashboardRoutes);
api.use('/health-certificates', healthCertificateRoutes);
api.use('/equipment', equipmentRoutes);
api.use(qualityRoutes);
api.use(confectioneryRoutes);
api.use(hseRoutes);
api.use(stockRoutes);
api.use(healthRegisterRoutes);
api.get('/audit-logs', authorize('audit:read'), validate({ query: audit.auditQuery }), audit.list);

export default api;
