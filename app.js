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
import notFound from './middlewares/notFound.js';
import globalErrorHandler from './middlewares/globalErrorHandler.js';
import { getAiServiceInfo } from './services/ai.service.js';

const app = express();

app.use(cors());
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

app.use(notFound);
app.use(globalErrorHandler);

export default app;
