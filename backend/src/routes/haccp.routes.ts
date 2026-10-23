import { Router } from 'express';
import * as haccp from '../controllers/haccp.controller';
import { authorize } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { idParams } from '../utils/schemas';

/** HACCP plan configuration: CCPs (critical limits) and digital form templates. */
const router = Router();

router.get('/ccps', authorize('record:read'), haccp.getCcps);
router.post('/ccps', authorize('haccp:manage'), validate({ body: haccp.ccpSchema }), haccp.createCcp);
router.patch('/ccps/:id', authorize('haccp:manage'), validate({ params: idParams, body: haccp.ccpUpdateSchema }), haccp.updateCcp);

router.get('/templates', authorize('record:read'), haccp.getTemplates);
router.get('/templates/:id', authorize('record:read'), validate({ params: idParams }), haccp.getTemplate);
router.post('/templates', authorize('haccp:manage'), validate({ body: haccp.templateSchema }), haccp.createTemplate);
router.patch('/templates/:id', authorize('haccp:manage'), validate({ params: idParams, body: haccp.templateUpdateSchema }), haccp.updateTemplate);
router.put('/templates/:id/options', authorize('haccp:manage'), validate({ params: idParams, body: haccp.optionsSchema }), haccp.updateOptions);
router.post('/templates/:id/prefill', authorize('record:create'), validate({ params: idParams, body: haccp.prefillSchema }), haccp.prefill);

export default router;
