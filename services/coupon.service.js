import { StatusCodes } from 'http-status-codes';
import Coupon from '../models/coupon.model.js';
import CouponRedemption from '../models/couponRedemption.model.js';
import User from '../models/user.model.js';
import ApiError from '../utils/ApiError.js';
import { createId } from '../lib/id.js';
import { grantManual, entitlementSnapshot } from './premium.service.js';

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const DEFAULT_TRIAL_DAYS = 7;

const randomCode = (length) => {
  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return result;
};

/**
 * Generates an uppercase A-Z0-9 coupon code (8-12 chars) that is not already
 * present in the Coupon collection.
 * @returns {Promise<string>}
 */
export const generateCouponCode = async () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const length = 8 + Math.floor(Math.random() * 5); // 8..12 inclusive
    const code = randomCode(length);
    const existing = await Coupon.findOne({ code }).lean();
    if (!existing) {
      return code;
    }
  }

  throw new ApiError(
    StatusCodes.INTERNAL_SERVER_ERROR,
    'Failed to generate a unique coupon code'
  );
};

/**
 * Redeems a coupon for a user, validating state and uniqueness, then applying a
 * premium grant via premium.service.
 * @param {{ userId: string, code: string }} params
 * @returns {Promise<{ coupon: object, entitlement: object }>}
 */
export const redeemCoupon = async ({ userId, code }) => {
  const normalizedCode = String(code || '').trim().toUpperCase();

  if (!normalizedCode) {
    const err = new ApiError(StatusCodes.BAD_REQUEST, 'Coupon code is required');
    err.code = 'COUPON_CODE_REQUIRED';
    throw err;
  }

  const coupon = await Coupon.findOne({ code: normalizedCode });

  if (!coupon) {
    const err = new ApiError(StatusCodes.NOT_FOUND, 'Coupon not found');
    err.code = 'COUPON_NOT_FOUND';
    throw err;
  }

  if (!coupon.active) {
    const err = new ApiError(StatusCodes.BAD_REQUEST, 'This coupon is no longer active');
    err.code = 'COUPON_INACTIVE';
    throw err;
  }

  if (coupon.expiresAt && new Date(coupon.expiresAt) <= new Date()) {
    const err = new ApiError(StatusCodes.BAD_REQUEST, 'This coupon has expired');
    err.code = 'COUPON_EXPIRED';
    err.details = { expiresAt: coupon.expiresAt };
    throw err;
  }

  if (coupon.redemptionsCount >= coupon.maxRedemptions) {
    const err = new ApiError(
      StatusCodes.BAD_REQUEST,
      'This coupon has reached its redemption limit'
    );
    err.code = 'COUPON_EXHAUSTED';
    err.details = {
      maxRedemptions: coupon.maxRedemptions,
      redemptionsCount: coupon.redemptionsCount
    };
    throw err;
  }

  const alreadyRedeemed = await CouponRedemption.findOne({
    couponId: coupon._id,
    userId
  }).lean();

  if (alreadyRedeemed) {
    const err = new ApiError(
      StatusCodes.CONFLICT,
      'You have already redeemed this coupon'
    );
    err.code = 'COUPON_ALREADY_REDEEMED';
    throw err;
  }

  // Create the redemption first (unique index couponId+userId guards races).
  try {
    await CouponRedemption.create({
      _id: createId('redemption'),
      couponId: coupon._id,
      userId,
      redeemedAt: new Date()
    });
  } catch (error) {
    if (error?.code === 11000) {
      const err = new ApiError(
        StatusCodes.CONFLICT,
        'You have already redeemed this coupon'
      );
      err.code = 'COUPON_ALREADY_REDEEMED';
      throw err;
    }
    throw error;
  }

  // Atomically increment redemptionsCount while re-checking the cap to avoid
  // overselling under concurrency. If the cap was hit, roll the redemption back.
  const incremented = await Coupon.findOneAndUpdate(
    {
      _id: coupon._id,
      redemptionsCount: { $lt: coupon.maxRedemptions }
    },
    { $inc: { redemptionsCount: 1 } },
    { new: true }
  );

  if (!incremented) {
    await CouponRedemption.deleteOne({ couponId: coupon._id, userId });
    const err = new ApiError(
      StatusCodes.BAD_REQUEST,
      'This coupon has reached its redemption limit'
    );
    err.code = 'COUPON_EXHAUSTED';
    throw err;
  }

  // Resolve the grant duration:
  //  - premium_grant: durationDays as-is (null => lifetime).
  //  - trial: always time-boxed; null defaults to DEFAULT_TRIAL_DAYS.
  let durationDays = coupon.durationDays;
  if (coupon.type === 'trial' && (durationDays === null || durationDays === undefined)) {
    durationDays = DEFAULT_TRIAL_DAYS;
  }

  const grantedUser = await grantManual(userId, { durationDays, source: 'coupon' });
  const user = grantedUser?.toObject ? grantedUser.toObject() : grantedUser || await User.findById(userId).lean();

  return {
    coupon: incremented.toObject ? incremented.toObject() : incremented,
    entitlement: entitlementSnapshot(user)
  };
};
