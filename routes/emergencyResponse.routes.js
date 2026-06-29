import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import {
  listEmergencyResponses,
  listAdminEmergencyResponses,
  createEmergencyResponse,
  previewEmergencyRoute,
  updateEmergencyResponse,
  deleteEmergencyResponse
} from '../controllers/emergencyResponse.controller.js';

// Public/user-facing router -> mount at /api/v1/emergency-responses
const userRouter = Router();
userRouter.use(requireAuth('user'));
userRouter.get('/', listEmergencyResponses);

// Admin CRUD router -> mount at /api/v1/admin/emergency-responses
export const adminEmergencyRouter = Router();
adminEmergencyRouter.use(requireAuth('admin'));
adminEmergencyRouter.get('/', listAdminEmergencyResponses);
adminEmergencyRouter.post('/preview-route', previewEmergencyRoute);
adminEmergencyRouter.post('/', createEmergencyResponse);
adminEmergencyRouter.patch('/:emergencyResponseId', updateEmergencyResponse);
adminEmergencyRouter.delete('/:emergencyResponseId', deleteEmergencyResponse);

export default userRouter;
