import { Router } from 'express';
import {
  googleRtdn,
  appleNotifications
} from '../controllers/webhook.controller.js';

// PUBLIC router — no auth. Store providers (Google Pub/Sub, Apple App Store
// Server Notifications) post here with their own signed payloads.
const router = Router();

router.post('/google/rtdn', googleRtdn);
router.post('/apple/notifications', appleNotifications);

export default router;
