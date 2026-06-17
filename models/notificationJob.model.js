import mongoose from 'mongoose';
import { createId } from '../lib/id.js';

const notificationJobSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => createId('notifjob')
    },
    userId: {
      type: String,
      required: true,
      index: true
    },
    type: {
      type: String,
      enum: ['material_expiry', 'inspection', 'custom'],
      default: 'custom'
    },
    refId: {
      type: String,
      default: null
    },
    title: {
      type: String,
      required: true
    },
    body: {
      type: String,
      default: ''
    },
    scheduledAt: {
      type: Date,
      required: true
    },
    channel: {
      type: String,
      enum: ['push', 'local'],
      default: 'local'
    },
    status: {
      type: String,
      enum: ['pending', 'sent', 'canceled', 'failed'],
      default: 'pending'
    },
    sentAt: {
      type: Date,
      default: null
    },
    error: {
      type: String,
      default: ''
    }
  },
  {
    versionKey: false,
    timestamps: true,
    collection: 'notification_jobs'
  }
);

notificationJobSchema.index({ status: 1, scheduledAt: 1 });

const NotificationJob =
  mongoose.models.NotificationJob ||
  mongoose.model('NotificationJob', notificationJobSchema);

export default NotificationJob;
