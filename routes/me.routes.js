import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { getEntitlements } from '../controllers/entitlement.controller.js';
import {
  registerDeviceToken,
  unregisterDeviceToken
} from '../controllers/deviceToken.controller.js';
import {
  getNotificationSettings,
  updateNotificationSettings
} from '../controllers/user.controller.js';

const router = Router();

router.use(requireAuth('user'));

router.get('/entitlements', getEntitlements);
router.post('/device-tokens', registerDeviceToken);
router.delete('/device-tokens', unregisterDeviceToken);
router.get('/notification-settings', getNotificationSettings);
router.put('/notification-settings', updateNotificationSettings);

export default router;
