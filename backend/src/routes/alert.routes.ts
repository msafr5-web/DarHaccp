import { Router } from 'express';
import * as alerts from '../controllers/alert.controller';
import { authorize } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { idParams } from '../utils/schemas';

const router = Router();

router.get('/', authorize('alert:read'), validate({ query: alerts.listAlertsQuery }), alerts.list);
router.get('/stream', authorize('alert:read'), alerts.stream);
router.post('/:id/acknowledge', authorize('alert:manage'), validate({ params: idParams }), alerts.acknowledge);
router.post('/:id/resolve', authorize('alert:manage'), validate({ params: idParams }), alerts.resolve);

export default router;
