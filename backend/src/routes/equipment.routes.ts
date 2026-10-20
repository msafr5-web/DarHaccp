import { Router } from 'express';
import * as equipment from '../controllers/equipment.controller';
import { authorize } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { idParams } from '../utils/schemas';

const router = Router();

router.get('/', authorize('equipment:read'), validate({ query: equipment.listEquipmentQuery }), equipment.list);
router.get('/:id', authorize('equipment:read'), validate({ params: idParams }), equipment.get);
router.post('/', authorize('equipment:manage'), validate({ body: equipment.equipmentSchema }), equipment.create);
router.patch('/:id', authorize('equipment:manage'), validate({ params: idParams, body: equipment.equipmentUpdateSchema }), equipment.update);
router.post('/:id/maintenance', authorize('equipment:manage'), validate({ params: idParams, body: equipment.maintenanceSchema }), equipment.addMaintenance);

export default router;
