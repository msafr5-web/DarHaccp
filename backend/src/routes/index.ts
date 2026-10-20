import { Router } from 'express';
import * as audit from '../controllers/audit.controller';
import * as users from '../controllers/user.controller';
import { authenticate, authorize, authorizeCron } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { runComplianceChecks } from '../services/scheduler.service';
import { ok } from '../utils/http';
import alertRoutes from './alert.routes';
import authRoutes from './auth.routes';
import capaRoutes from './capa.routes';
import dashboardRoutes from './dashboard.routes';
import equipmentRoutes from './equipment.routes';
import haccpRoutes from './haccp.routes';
import healthCertificateRoutes from './healthCertificate.routes';
import kitchenRoutes from './kitchen.routes';
import qrRoutes from './qr.routes';
import userRoutes from './user.routes';

const api = Router();

api.use('/auth', authRoutes);

// Serverless deployments have no long-running scheduler: Vercel Cron calls this daily.
api.get('/internal/cron/compliance', authorizeCron, async (_req, res) => {
  ok(res, await runComplianceChecks());
});

// Everything below requires a valid JWT.
api.use(authenticate);
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
api.get('/audit-logs', authorize('audit:read'), validate({ query: audit.auditQuery }), audit.list);

export default api;
