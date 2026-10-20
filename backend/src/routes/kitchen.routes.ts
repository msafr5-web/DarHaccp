import { Router } from 'express';
import * as haccp from '../controllers/haccp.controller';
import { authorize, authorizeDepartment } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { idParams } from '../utils/schemas';

/**
 * Department-scoped routes: /api/v1/kitchens/:department/...
 *   :department = hot | cold | sweets | support
 * authorizeDepartment isolates kitchens: a chef of the HOT kitchen cannot read or write COLD records.
 */
const router = Router({ mergeParams: true });

router.use(authorizeDepartment);

router.get('/records', authorize('record:read'), validate({ query: haccp.listRecordsQuery }), haccp.getRecords);
router.get('/records/:id', authorize('record:read'), validate({ params: idParams }), haccp.getRecord);
router.post('/records', authorize('record:create'), validate({ body: haccp.submitRecordSchema }), haccp.createRecord);

export default router;
