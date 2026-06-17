import mongoose from 'mongoose';
import { createId } from '../lib/id.js';

const deviceTokenSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => createId('device')
    },
    userId: {
      type: String,
      required: true,
      index: true
    },
    token: {
      type: String,
      required: true
    },
    platform: {
      type: String,
      enum: ['android', 'ios', 'web'],
      default: 'android'
    }
  },
  {
    versionKey: false,
    timestamps: true,
    collection: 'device_tokens'
  }
);

deviceTokenSchema.index({ token: 1 }, { unique: true });

const DeviceToken =
  mongoose.models.DeviceToken || mongoose.model('DeviceToken', deviceTokenSchema);

export default DeviceToken;
