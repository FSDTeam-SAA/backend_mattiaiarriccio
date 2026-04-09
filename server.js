import 'dotenv/config';
import app from './app.js';
import { connectToDatabase } from './config/db.js';
import { seedDatabase } from './services/seed.service.js';

const PORT = process.env.PORT || 5000;

let server;

const startServer = async () => {
  await connectToDatabase();
  await seedDatabase();

  server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
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
