import mongoose from 'mongoose';
import { createId } from '../lib/id.js';

const subscriptionSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => createId('sub')
    },
    userId: {
      type: String,
      required: true,
      index: true
    },
    store: {
      type: String,
      enum: ['google_play', 'app_store'],
      required: true
    },
    productId: {
      type: String,
      default: ''
    },
    // Apple originalTransactionId or Google purchaseToken
    transactionId: {
      type: String,
      required: true
    },
    status: {
      type: String,
      enum: ['active', 'expired', 'in_grace', 'canceled', 'refunded'],
      default: 'active'
    },
    expiresAt: {
      type: Date,
      default: null
    },
    // Last verified provider payload (raw)
    latestRaw: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    }
  },
  {
    versionKey: false,
    timestamps: true,
    collection: 'subscriptions'
  }
);

subscriptionSchema.index({ transactionId: 1 }, { unique: true });

const Subscription =
  mongoose.models.Subscription || mongoose.model('Subscription', subscriptionSchema);

export default Subscription;
