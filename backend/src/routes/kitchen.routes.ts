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
// Amendments: FILL_EDIT permission + mandatory reason, checked in the service; history kept in record_revisions.
router.patch('/records/:id', authorize('record:create'), validate({ params: idParams, body: haccp.amendRecordSchema }), haccp.amend);
router.get('/records/:id/revisions', authorize('record:read'), validate({ params: idParams }), haccp.revisions);

export default router;
