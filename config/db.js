import mongoose from 'mongoose';

const DEFAULT_URI = 'mongodb://127.0.0.1:27017/wesafe';

export const getMongoUri = () => process.env.MONGODB_URI || DEFAULT_URI;

export const connectToDatabase = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  await mongoose.connect(getMongoUri());
  return mongoose.connection;
};

export const disconnectFromDatabase = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
};
