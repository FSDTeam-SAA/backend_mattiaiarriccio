import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes.js';
import docsRoutes from './routes/docs.routes.js';
import homeRoutes from './routes/home.routes.js';
import userRoutes from './routes/user.routes.js';
import legalRoutes from './routes/legal.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import safetyTipRoutes from './routes/safetyTip.routes.js';
import checklistRoutes from './routes/checklist.routes.js';
import categoryRoutes from './routes/category.routes.js';
import chatRoutes from './routes/chat.routes.js';
import adminRoutes from './routes/admin.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import subscriptionRoutes from './routes/subscription.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import couponRoutes, { adminCouponRouter } from './routes/coupon.routes.js';
import adminUserRoutes from './routes/adminUser.routes.js';
import emergencyResponseRoutes, { adminEmergencyRouter } from './routes/emergencyResponse.routes.js';
import meRoutes from './routes/me.routes.js';
import materialRoutes from './routes/material.routes.js';
import adminNotificationRoutes from './routes/adminNotification.routes.js';
import adminMaterialRoutes from './routes/adminMaterial.routes.js';
import adRoutes from './routes/ad.routes.js';
import adminAdsRoutes from './routes/adminAds.routes.js';
import adminSettingsRoutes from './routes/adminSettings.routes.js';
import notFound from './middlewares/notFound.js';
import globalErrorHandler from './middlewares/globalErrorHandler.js';
import requestLogger from './middlewares/requestLogger.js';
import { getAiServiceInfo } from './services/ai.service.js';

const app = express();

app.use(cors());
app.use(requestLogger);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  const aiService = getAiServiceInfo();

  res.status(200).json({
    success: true,
    message: 'We Safe backend API is running',
    data: {
      docs: '/docs',
      apiCatalog: '/docs/json',
      health: '/',
      aiService
    }
  });
});

app.use('/docs', docsRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/home', homeRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/legal', legalRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/safety-tips', safetyTipRoutes);
app.use('/api/v1/checklists', checklistRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/chat', chatRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/uploads', uploadRoutes);

// Subscriptions / IAP + store webhooks (webhooks are PUBLIC, no auth)
app.use('/api/v1/subscriptions', subscriptionRoutes);
app.use('/webhooks', webhookRoutes);

// Coupons (user redeem) + admin coupon management
app.use('/api/v1/coupons', couponRoutes);
app.use('/api/v1/admin/coupons', adminCouponRouter);

// Admin user management + premium grant/revoke
app.use('/api/v1/admin/users', adminUserRoutes);

// Emergency responses (user list) + admin CRUD
app.use('/api/v1/emergency-responses', emergencyResponseRoutes);
app.use('/api/v1/admin/emergency-responses', adminEmergencyRouter);

// Entitlements + device tokens
app.use('/api/v1/me', meRoutes);

// Materials (expiration tracking) + admin oversight
app.use('/api/v1/materials', materialRoutes);
app.use('/api/v1/admin/materials', adminMaterialRoutes);
app.use('/api/v1/admin/notifications', adminNotificationRoutes);

// Ads: app-facing config + admin ad settings
app.use('/api/v1/ad-config', adRoutes);
app.use('/api/v1/admin/settings/ad-config', adminAdsRoutes);

// Admin app-settings (limits, tier prompts, access rules, toggles)
app.use('/api/v1/admin/app-settings', adminSettingsRoutes);

app.use(notFound);
app.use(globalErrorHandler);

export default app;
