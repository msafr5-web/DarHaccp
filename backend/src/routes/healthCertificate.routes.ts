import { Router } from 'express';
import * as certs from '../controllers/healthCertificate.controller';
import { authorize } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { idParams } from '../utils/schemas';

const router = Router();

router.get('/', authorize('healthcert:read'), validate({ query: certs.listCertsQuery }), certs.list);
router.post('/', authorize('healthcert:manage'), validate({ body: certs.certSchema }), certs.create);
router.patch('/:id', authorize('healthcert:manage'), validate({ params: idParams, body: certs.certUpdateSchema }), certs.update);

export default router;
