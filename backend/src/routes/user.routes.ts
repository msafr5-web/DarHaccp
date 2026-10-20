import { Router } from 'express';
import * as users from '../controllers/user.controller';
import { authorize } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { idParams } from '../utils/schemas';

const router = Router();

router.use(authorize('user:manage'));
router.get('/', validate({ query: users.listUsersQuery }), users.list);
router.post('/', validate({ body: users.createUserSchema }), users.create);
router.patch('/:id', validate({ params: idParams, body: users.updateUserSchema }), users.update);

export default router;
