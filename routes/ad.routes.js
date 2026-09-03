import { Router } from 'express';
import { optionalAuth } from '../middlewares/auth.js';
import { getAdConfig } from '../controllers/adConfig.controller.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const router = Router();

// Optional auth: the controller already handles the anonymous case (ads on by
// default) and only runs the premium check when a user is known. Requiring a
// token here made the app's very first config fetch — which fires before login
// — 401, and the client treats any failure as "no ads".
router.use(optionalAuth());

router.get('/', getAdConfig);

export default router;					