import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import {
  listUsers,
  getUser,
  grantPremium,
  revokePremium
} from '../controllers/adminUser.controller.js';

const router = Router();

router.use(requireAuth('admin'));

router.get('/', listUsers);
router.get('/:userId', getUser);
router.post('/:userId/grant-premium', grantPremium);
router.post('/:userId/revoke-premium', revokePremium);

export default router;
