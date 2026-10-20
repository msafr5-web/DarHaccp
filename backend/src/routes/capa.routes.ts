import { Router } from 'express';
import * as capas from '../controllers/capa.controller';
import { authorize } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { idParams } from '../utils/schemas';

const router = Router();

router.get('/', authorize('capa:read'), validate({ query: capas.listCapasQuery }), capas.list);
router.get('/:id', authorize('capa:read'), validate({ params: idParams }), capas.get);
router.patch('/:id', authorize('capa:update'), validate({ params: idParams, body: capas.capaUpdateSchema }), capas.update);
router.post('/:id/close', authorize('capa:update'), validate({ params: idParams, body: capas.capaUpdateSchema }), capas.close);
router.post('/:id/verify', authorize('capa:verify'), validate({ params: idParams, body: capas.capaVerifySchema }), capas.verify);

export default router;
