import { Router } from 'express';
import * as quality from '../controllers/quality.controller';
import { authorize } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { idParams } from '../utils/schemas';

/** Quality & continuous improvement: incidents / non-conformities and internal audits (PRD §2.1-5). */
const router = Router();

router.get('/incidents', authorize('incident:read'), validate({ query: quality.listIncidentsQuery }), quality.listIncidents);
router.get('/incidents/:id', authorize('incident:read'), validate({ params: idParams }), quality.getIncident);
router.post('/incidents', authorize('incident:create'), validate({ body: quality.incidentSchema }), quality.createIncident);
router.patch('/incidents/:id', authorize('capa:update'), validate({ params: idParams, body: quality.incidentUpdateSchema }), quality.updateIncident);

router.get('/internal-audits/checklists', authorize('internal-audit:read'), quality.checklists);
router.get('/internal-audits', authorize('internal-audit:read'), validate({ query: quality.listAuditsQuery }), quality.listAudits);
router.get('/internal-audits/:id', authorize('internal-audit:read'), validate({ params: idParams }), quality.getAudit);
router.post('/internal-audits', authorize('internal-audit:manage'), validate({ body: quality.planAuditSchema }), quality.createAudit);
router.post('/internal-audits/:id/complete', authorize('internal-audit:manage'), validate({ params: idParams, body: quality.completeAuditSchema }), quality.finishAudit);

export default router;
