import { Router } from 'express';
import { getDocsJson, renderDocsPage } from '../controllers/docs.controller.js';

const router = Router();

router.get('/', renderDocsPage);
router.get('/json', getDocsJson);

export default router;
