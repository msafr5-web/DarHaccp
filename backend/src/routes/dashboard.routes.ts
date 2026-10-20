import { Router } from 'express';
import * as dashboard from '../controllers/dashboard.controller';
import { authorize } from '../middlewares/auth';
import { validate } from '../middlewares/validate';

const router = Router();

router.use(authorize('dashboard:view'));
router.get('/overview', validate({ query: dashboard.overviewQuery }), dashboard.overview);
router.get('/compliance-trend', validate({ query: dashboard.trendQuery }), dashboard.trend);
router.get('/deviations', validate({ query: dashboard.deviationsQuery }), dashboard.deviations);
router.get('/health-certificates', validate({ query: dashboard.scopeQuery }), dashboard.healthCertificates);
router.get('/equipment', validate({ query: dashboard.scopeQuery }), dashboard.equipment);

export default router;
