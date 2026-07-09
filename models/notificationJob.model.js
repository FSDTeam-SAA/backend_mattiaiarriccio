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
      enum: [
        'material_expiry',
        'inspection',
        'checklist_item',
        'premium_expiry',
        'premium',
        'premium_offer',
        'guide_update',
        'app_update',
        'custom'
      ],
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
      enum: ['push', 'local', 'email'],
      default: 'local'
    },
    status: {
      type: String,
      // 'sent' = actually delivered; 'skipped' = intentionally not delivered
      // (user opt-out, no device token, channel unconfigured) — recorded but not
      // counted as a delivery.
      enum: ['pending', 'sent', 'skipped', 'canceled', 'failed'],
      default: 'pending'
    },
    sentAt: {
      type: Date,
      default: null
    },
    error: {
      type: String,
      default: ''
    },
    // Retry bookkeeping. `attempts` counts delivery tries; once it reaches
    // `maxAttempts` a transient failure becomes terminal ('failed'). `retryAt`
    // mirrors the rescheduled `scheduledAt` for observability; `lastError` keeps
    // the most recent transient error separate from the display `error`.
    attempts: {
      type: Number,
      default: 0
    },
    maxAttempts: {
      type: Number,
      default: 3
    },
    retryAt: {
      type: Date,
      default: null
    },
    lastError: {
      type: String,
      default: ''
    },
    // Groups the per-user jobs created by a single admin broadcast so history can
    // roll them up into one campaign with sent/failed counts.
    campaignId: {
      type: String,
      default: null,
      index: true
    },
    // Optional localization descriptor. When set, the dispatcher renders the
    // title/body in the recipient's language via notificationContent.service;
    // the stored title/body remain the English fallback (and admin-history text).
    contentKey: {
      type: String,
      default: null
    },
    contentParams: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    // When false, a 'push' job delivers to the device only and does NOT create an
    // in-app bell record (used as a reliable push retry for a notification whose
    // in-app record was already created elsewhere). Defaults to true.
    inApp: {
      type: Boolean,
      default: true
    }
  },
  {
    versionKey: false,
    timestamps: true,
    collection: 'notification_jobs'
  }
);

notificationJobSchema.index({ status: 1, scheduledAt: 1 });
notificationJobSchema.index({ userId: 1, createdAt: -1 });

const NotificationJob =
  mongoose.models.NotificationJob ||
  mongoose.model('NotificationJob', notificationJobSchema);

export default NotificationJob;
