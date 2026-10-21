import { Router } from 'express';
import * as hse from '../controllers/hse.controller';
import * as staff from '../controllers/staff.controller';
import * as iot from '../controllers/iot.controller';
import { authorize } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { idParams } from '../utils/schemas';

/** HSE & support services: staff registry, contractors, controlled documents, IoT device keys (PRD §4.1). */
const router = Router();

router.get('/staff', authorize('staff:read'), validate({ query: staff.listStaffQuery }), staff.list);
router.get('/staff/:id', authorize('staff:read'), validate({ params: idParams }), staff.get);
router.post('/staff', authorize('staff:manage'), validate({ body: staff.staffSchema }), staff.create);
router.patch('/staff/:id', authorize('staff:manage'), validate({ params: idParams, body: staff.staffUpdateSchema }), staff.update);

router.get('/contractors', authorize('contractor:read'), validate({ query: hse.listContractorsQuery }), hse.listContractors);
router.get('/contractors/:id', authorize('contractor:read'), validate({ params: idParams }), hse.getContractor);
router.post('/contractors', authorize('contractor:manage'), validate({ body: hse.contractorSchema }), hse.createContractor);
router.patch('/contractors/:id', authorize('contractor:manage'), validate({ params: idParams, body: hse.contractorUpdateSchema }), hse.updateContractor);
router.post('/contractors/:id/evaluations', authorize('contractor:manage'), validate({ params: idParams, body: hse.evaluationSchema }), hse.evaluateContractor);

router.get('/documents', authorize('document:read'), validate({ query: hse.listDocumentsQuery }), hse.listDocuments);
router.post('/documents', authorize('document:manage'), validate({ body: hse.documentSchema }), hse.createDocument);
router.patch('/documents/:id', authorize('document:manage'), validate({ params: idParams, body: hse.documentUpdateSchema }), hse.updateDocument);

router.post('/equipment/:id/device-key', authorize('iot:manage'), validate({ params: idParams }), iot.issueDeviceKey);

export default router;
