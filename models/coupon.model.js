import mongoose from 'mongoose';
import { createId } from '../lib/id.js';

const couponSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => createId('coupon')
    },
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true
    },
    type: {
      type: String,
      enum: ['premium_grant', 'trial'],
      required: true
    },
    // null = lifetime for premium_grant
    durationDays: {
      type: Number,
      default: null
    },
    maxRedemptions: {
      type: Number,
      default: 1
    },
    redemptionsCount: {
      type: Number,
      default: 0
    },
    expiresAt: {
      type: Date,
      default: null
    },
    active: {
      type: Boolean,
      default: true
    },
    createdBy: {
      type: String,
      default: null
    }
  },
  {
    versionKey: false,
    timestamps: true,
    collection: 'coupons'
  }
);

couponSchema.index({ code: 1 }, { unique: true });

const Coupon = mongoose.models.Coupon || mongoose.model('Coupon', couponSchema);

export default Coupon;
