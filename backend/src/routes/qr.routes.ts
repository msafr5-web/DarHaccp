import { Router } from 'express';
import * as qr from '../controllers/qr.controller';
import { authorize } from '../middlewares/auth';
import { validate } from '../middlewares/validate';

const router = Router();

// Mobile app: scanned payload -> digital form to fill.
router.post('/resolve', authorize('record:create'), validate({ body: qr.resolveSchema }), qr.resolve);

router.get('/labels', authorize('qr:manage'), validate({ query: qr.labelsQuery }), qr.labels);
router.get('/:target/:id/image', authorize('qr:manage'), validate({ params: qr.qrTargetParams, query: qr.imageQuery }), qr.image);
router.post('/:target/:id/rotate', authorize('qr:manage'), validate({ params: qr.qrTargetParams }), qr.rotate);

export default router;
