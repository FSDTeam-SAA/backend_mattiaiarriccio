import mongoose from 'mongoose';
import { createId } from '../lib/id.js';

/**
 * One admin broadcast. Groups the per-user NotificationJobs it enqueued and
 * carries an optional client-supplied `idempotencyKey` so a re-submitted send
 * (double click, network retry) resolves to the SAME campaign instead of
 * creating a duplicate batch of jobs.
 */
const notificationCampaignSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => createId('campaign')
    },
    // Client-generated key; null for legacy/keyless sends.
    idempotencyKey: {
      type: String,
      default: null
    },
    createdBy: {
      type: String,
      required: true
    },
    title: {
      type: String,
      default: ''
    },
    body: {
      type: String,
      default: ''
    },
    channels: {
      type: [String],
      default: []
    },
    audienceType: {
      type: String,
      default: 'all'
    },
    recipients: {
      type: Number,
      default: 0
    },
    jobCount: {
      type: Number,
      default: 0
    },
    status: {
      type: String,
      enum: ['queued', 'failed'],
      default: 'queued'
    }
  },
  {
    versionKey: false,
    timestamps: true,
    collection: 'notification_campaigns'
  }
);

// Unique only among real (string) keys so multiple keyless campaigns coexist.
notificationCampaignSchema.index(
  { idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } }
  }
);

const NotificationCampaign =
  mongoose.models.NotificationCampaign ||
  mongoose.model('NotificationCampaign', notificationCampaignSchema);

export default NotificationCampaign;
