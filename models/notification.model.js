import mongoose from 'mongoose';
import { createId } from '../lib/id.js';

const notificationSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => createId('notif')
    },
    userId: {
      type: String,
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    body: {
      type: String,
      required: true,
      trim: true
    },
    type: {
      type: String,
      default: 'general'
    },
    read: {
      type: Boolean,
      default: false
    }
  },
  {
    versionKey: false,
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'notifications'
  }
);

const Notification =
  mongoose.models.Notification || mongoose.model('Notification', notificationSchema);

export default Notification;
