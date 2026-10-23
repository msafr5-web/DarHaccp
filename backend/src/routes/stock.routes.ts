import express, { Router } from 'express';
import * as stock from '../controllers/stock.controller';
import { authorize } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { idParams } from '../utils/schemas';

/** Item master, FEFO stock engine and batch traceability (recall). */
const router = Router();

router.get('/items', authorize('record:read'), validate({ query: stock.itemsQuery }), stock.listItems);
router.get('/items/export.xlsx', authorize('record:read'), validate({ query: stock.exportQuery }), stock.exportItemsXlsx);
// The workbook is sent as the raw request body (max 4 MB — the serverless request limit is 4.5 MB).
router.post('/items/import', authorize('item:manage'),
  express.raw({ type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'], limit: '4mb' }),
  validate({ query: stock.importQuery }), stock.importItemsXlsx);
router.post('/items', authorize('item:manage'), validate({ body: stock.itemSchema }), stock.createItem);
router.patch('/items/:id', authorize('item:manage'), validate({ params: idParams, body: stock.itemUpdateSchema }), stock.updateItem);

router.get('/stock/batches', authorize('record:read'), validate({ query: stock.batchesQuery }), stock.listBatches);
router.get('/stock/batches/:id/movements', authorize('record:read'), validate({ params: idParams }), stock.batchMovements);

router.get('/traceability', authorize('record:read'), validate({ query: stock.traceQuery }), stock.traceability);

export default router;
