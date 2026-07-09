import 'dotenv/config';
import app from './app.js';
import { connectToDatabase } from './config/db.js';
import { seedDatabase } from './services/seed.service.js';
import { seedSettings } from './services/settings.service.js';
import { initScheduler } from './services/scheduler.service.js';
import { initSocket } from './services/socket.service.js';
import { verifyEmailTransport } from './services/email.service.js';

const PORT = process.env.PORT || 5000;

let server;

const startServer = async () => {
  await connectToDatabase();
  await seedDatabase();
  // Ensure all AppSetting keys exist (idempotent, safe on every boot).
  await seedSettings();

  // Reminder/notification scheduler (MongoDB-backed Agenda). Never let a
  // scheduler failure prevent the API from serving requests.
  try {
    await initScheduler();
  } catch (error) {
    console.error('Failed to start reminder scheduler', error);
  }

  // Boot-time email health check (log-only, non-blocking) so an invalid SMTP
  // credential is visible at startup rather than failing silently later.
  verifyEmailTransport();

  server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Realtime (Socket.IO) on the same HTTP server. Never let a socket failure stop
  // the API from serving requests.
  try {
    await initSocket(server);
    console.log('[socket.service] Socket.IO realtime initialized.');
  } catch (error) {
    console.error('Failed to start Socket.IO server', error);
  }
};

startServer().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('UNHANDLED REJECTION! Shutting down...', error);
  if (server) {
    server.close(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT EXCEPTION! Shutting down...', error);
  process.exit(1);
});
