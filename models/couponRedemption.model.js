import mongoose from 'mongoose';
import { createId } from '../lib/id.js';

const couponRedemptionSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => createId('redemption')
    },
    couponId: {
      type: String,
      required: true
    },
    userId: {
      type: String,
      required: true
    },
    redeemedAt: {
      type: Date,
      default: () => new Date()
    }
  },
  {
    versionKey: false,
    timestamps: true,
    collection: 'coupon_redemptions'
  }
);

couponRedemptionSchema.index({ couponId: 1, userId: 1 }, { unique: true });

const CouponRedemption =
  mongoose.models.CouponRedemption ||
  mongoose.model('CouponRedemption', couponRedemptionSchema);

export default CouponRedemption;
