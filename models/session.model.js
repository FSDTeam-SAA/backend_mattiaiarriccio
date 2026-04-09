import mongoose from 'mongoose';
import { createId } from '../lib/id.js';

const sessionSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => createId('session')
    },
    userId: {
      type: String,
      required: true,
      index: true
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      required: true
    },
    token: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true
    }
  },
  {
    versionKey: false,
    timestamps: true,
    collection: 'sessions'
  }
);

const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);

export default Session;
