import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import { sendSuccess, parsePagination } from '../utils/response.js';
import Coupon from '../models/coupon.model.js';
import CouponRedemption from '../models/couponRedemption.model.js';
import { createId } from '../lib/id.js';
import { logAudit } from '../services/audit.service.js';
import {
  parseBooleanInput,
  parseIntegerInput
} from '../utils/requestParsers.js';
import { generateCouponCode, redeemCoupon } from '../services/coupon.service.js';

const COUPON_TYPES = ['premium_grant', 'trial'];

const mapCouponPayload = (coupon) => ({
  id: coupon._id,
  code: coupon.code,
  type: coupon.type,
  durationDays: coupon.durationDays ?? null,
  maxRedemptions: coupon.maxRedemptions,
  redemptionsCount: coupon.redemptionsCount,
  remainingRedemptions: Math.max(
    coupon.maxRedemptions - coupon.redemptionsCount,
    0
  ),
  expiresAt: coupon.expiresAt ?? null,
  active: coupon.active,
  createdBy: coupon.createdBy ?? null,
  createdAt: coupon.createdAt,
  updatedAt: coupon.updatedAt
});

const parseExpiresAt = (value) => {
  if (value === null || value === '') {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'expiresAt must be a valid date');
  }
  return parsed;
};

/**
 * POST /api/v1/coupons/redeem
 * Body: { code }
 */
export const redeem = catchAsync(async (req, res) => {
  const userId = req.auth.user._id;
  const code = String(req.body.code || '').trim();

  if (!code) {
    const err = new ApiError(StatusCodes.BAD_REQUEST, 'code is required');
    err.code = 'COUPON_CODE_REQUIRED';
    throw err;
  }

  const { coupon, entitlement } = await redeemCoupon({ userId, code });

  sendSuccess(res, {
    message: 'Coupon redeemed successfully',
    data: {
      coupon: {
        code: coupon.code,
        type: coupon.type,
        durationDays: coupon.durationDays ?? null
      },
      entitlement
    }
  });
});

/**
 * POST /api/v1/admin/coupons
 * Body: { code?, type, durationDays?, maxRedemptions?, expiresAt?, active? }
 */
export const createCoupon = catchAsync(async (req, res) => {
  const adminId = req.auth.user._id;

  const type = String(req.body.type || '').trim();
  if (!COUPON_TYPES.includes(type)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `type must be one of: ${COUPON_TYPES.join(', ')}`
    );
  }

  let code = String(req.body.code || '').trim().toUpperCase();
  if (!code) {
    code = await generateCouponCode();
  } else {
    const existing = await Coupon.findOne({ code }).lean();
    if (existing) {
      throw new ApiError(
        StatusCodes.CONFLICT,
        'A coupon with this code already exists'
      );
    }
  }

  const durationDaysInput = parseIntegerInput(req.body.durationDays);
  const durationDays =
    req.body.durationDays === null || req.body.durationDays === ''
      ? null
      : durationDaysInput ?? null;

  if (durationDays !== null && durationDays <= 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'durationDays must be a positive number or null'
    );
  }

  const maxRedemptions = parseIntegerInput(req.body.maxRedemptions) ?? 1;
  if (maxRedemptions < 1) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'maxRedemptions must be at least 1'
    );
  }

  const expiresAt =
    req.body.expiresAt !== undefined ? parseExpiresAt(req.body.expiresAt) : null;
  const active = parseBooleanInput(req.body.active) ?? true;

  const coupon = await Coupon.create({
    _id: createId('coupon'),
    code,
    type,
    durationDays,
    maxRedemptions,
    redemptionsCount: 0,
    expiresAt,
    active,
    createdBy: adminId
  });

  await logAudit({
    adminId,
    action: 'coupon.create',
    meta: {
      couponId: coupon._id,
      code: coupon.code,
      type: coupon.type,
      durationDays: coupon.durationDays,
      maxRedemptions: coupon.maxRedemptions
    }
  });

  sendSuccess(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Coupon created successfully',
    data: mapCouponPayload(coupon.toObject())
  });
});

/**
 * GET /api/v1/admin/coupons
 * Query: page, limit, active, type, search
 */
export const listCoupons = catchAsync(async (req, res) => {
  const { page, limit } = parsePagination(req.query, {
    page: 1,
    limit: 20,
    maxLimit: 100
  });

  const filter = {};

  if (req.query.active !== undefined) {
    const active = parseBooleanInput(req.query.active);
    if (active !== undefined) {
      filter.active = active;
    }
  }

  if (req.query.type !== undefined && COUPON_TYPES.includes(String(req.query.type))) {
    filter.type = String(req.query.type);
  }

  if (req.query.search) {
    filter.code = {
      $regex: String(req.query.search).trim().toUpperCase(),
      $options: 'i'
    };
  }

  const [coupons, total] = await Promise.all([
    Coupon.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Coupon.countDocuments(filter)
  ]);

  sendSuccess(res, {
    message: 'Coupons fetched successfully',
    data: coupons.map(mapCouponPayload),
    meta: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit)
    }
  });
});

/**
 * PATCH /api/v1/admin/coupons/:couponId
 * Body: { active?, maxRedemptions?, expiresAt?, durationDays?, type? }
 */
export const updateCoupon = catchAsync(async (req, res) => {
  const adminId = req.auth.user._id;
  const coupon = await Coupon.findById(req.params.couponId);

  if (!coupon) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Coupon not found');
  }

  const changes = {};

  if (req.body.active !== undefined) {
    const active = parseBooleanInput(req.body.active);
    if (active !== undefined) {
      coupon.active = active;
      changes.active = active;
    }
  }

  if (req.body.type !== undefined) {
    const type = String(req.body.type).trim();
    if (!COUPON_TYPES.includes(type)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `type must be one of: ${COUPON_TYPES.join(', ')}`
      );
    }
    coupon.type = type;
    changes.type = type;
  }

  if (req.body.durationDays !== undefined) {
    if (req.body.durationDays === null || req.body.durationDays === '') {
      coupon.durationDays = null;
      changes.durationDays = null;
    } else {
      const durationDays = parseIntegerInput(req.body.durationDays);
      if (durationDays === undefined || durationDays <= 0) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          'durationDays must be a positive number or null'
        );
      }
      coupon.durationDays = durationDays;
      changes.durationDays = durationDays;
    }
  }

  if (req.body.maxRedemptions !== undefined) {
    const maxRedemptions = parseIntegerInput(req.body.maxRedemptions);
    if (maxRedemptions === undefined || maxRedemptions < 1) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'maxRedemptions must be at least 1'
      );
    }
    if (maxRedemptions < coupon.redemptionsCount) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'maxRedemptions cannot be lower than the current redemptions count'
      );
    }
    coupon.maxRedemptions = maxRedemptions;
    changes.maxRedemptions = maxRedemptions;
  }

  if (req.body.expiresAt !== undefined) {
    coupon.expiresAt = parseExpiresAt(req.body.expiresAt);
    changes.expiresAt = coupon.expiresAt;
  }

  await coupon.save();

  await logAudit({
    adminId,
    action: 'coupon.update',
    meta: {
      couponId: coupon._id,
      code: coupon.code,
      changes
    }
  });

  sendSuccess(res, {
    message: 'Coupon updated successfully',
    data: mapCouponPayload(coupon.toObject())
  });
});

/**
 * DELETE /api/v1/admin/coupons/:couponId
 */
export const deleteCoupon = catchAsync(async (req, res) => {
  const adminId = req.auth.user._id;
  const coupon = await Coupon.findByIdAndDelete(req.params.couponId);

  if (!coupon) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Coupon not found');
  }

  await CouponRedemption.deleteMany({ couponId: coupon._id });

  await logAudit({
    adminId,
    action: 'coupon.delete',
    meta: {
      couponId: coupon._id,
      code: coupon.code
    }
  });

  sendSuccess(res, {
    message: 'Coupon deleted successfully'
  });
});
