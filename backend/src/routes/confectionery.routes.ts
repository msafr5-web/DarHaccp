import { Router } from 'express';
import * as sweets from '../controllers/confectionery.controller';
import { authorize } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { idParams } from '../utils/schemas';

/** Recipes and product data cards (PRD §4.4). */
const router = Router();

router.get('/recipes', authorize('recipe:read'), validate({ query: sweets.listRecipesQuery }), sweets.listRecipes);
router.post('/recipes', authorize('recipe:manage'), validate({ body: sweets.recipeSchema }), sweets.createRecipe);
router.patch('/recipes/:id', authorize('recipe:manage'), validate({ params: idParams, body: sweets.recipeUpdateSchema }), sweets.updateRecipe);

router.get('/labels', authorize('label:read'), validate({ query: sweets.listLabelsQuery }), sweets.listLabels);
router.get('/labels/:id', authorize('label:read'), validate({ params: idParams }), sweets.getLabel);
router.post('/labels', authorize('label:create'), validate({ body: sweets.labelSchema }), sweets.createLabel);
router.patch('/labels/:id/status', authorize('label:create'), validate({ params: idParams, body: sweets.labelStatusSchema }), sweets.updateLabelStatus);
router.post('/labels/:id/print-link', authorize('label:read'), validate({ params: idParams }), sweets.printLink);

export default router;
