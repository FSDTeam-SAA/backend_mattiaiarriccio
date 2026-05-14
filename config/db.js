import mongoose from 'mongoose';
import { ensurePromptConfigIndexes } from '../models/promptConfig.model.js';

const DEFAULT_URI = 'mongodb://127.0.0.1:27017/wesafe';
let indexesReady = false;

export const getMongoUri = () => process.env.MONGODB_URI || DEFAULT_URI;

export const connectToDatabase = async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(getMongoUri());
  }

  if (!indexesReady) {
    await ensurePromptConfigIndexes();
    indexesReady = true;
  }

  return mongoose.connection;
};

export const disconnectFromDatabase = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
};
