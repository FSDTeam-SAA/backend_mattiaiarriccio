import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import { sendSuccess, parsePagination } from '../utils/response.js';
import { publicUser } from '../utils/serializers.js';
import { parseIntegerInput } from '../utils/requestParsers.js';
import User from '../models/user.model.js';
import Subscription from '../models/subscription.model.js';
import CouponRedemption from '../models/couponRedemption.model.js';
import { grantManual, revoke } from '../services/premium.service.js';
import { logAudit, listAuditForUser } from '../services/audit.service.js';
import { notifyUser } from '../services/notify.service.js';
import { pushEnabledForUser } from '../utils/notificationPrefs.js';
import { enqueuePremiumActivationPush } from '../services/subscriptionNotifications.service.js';

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Safe admin row projection: extends the public serializer with the
// premium/tier fields the admin table needs. NEVER includes passwordHash.
const adminUserRow = (user) => ({
  ...publicUser(user),
  tier: user.tier ?? 'free',
  premiumSource: user.premiumSource ?? null,
  premiumExpiresAt: user.premiumExpiresAt ?? null
});

// Full admin detail projection. Built from a safe whitelist; passwordHash is
// intentionally omitted.
const adminUserDetail = (user) => ({
  ...adminUserRow(user),
  premiumGrantedBy: user.premiumGrantedBy ?? null,
  manualPremiumActive: Boolean(user.manualPremiumActive),
  manualPremiumExpiresAt: user.manualPremiumExpiresAt ?? null,
  manualPremiumSource: user.manualPremiumSource ?? null,
  dailyUsage: user.dailyUsage ?? { date: '', messages: 0, chats: 0 }
});

export const listUsers = catchAsync(async (req, res) => {
  const { page, limit } = parsePagination(req.query, {
    page: 1,
    limit: 20,
    maxLimit: 100
  });

  const search = String(req.query.search || '').trim();
  const tier = String(req.query.tier || '').trim().toLowerCase();

  const filter = {};

  if (search) {
    const pattern = new RegExp(escapeRegExp(search), 'i');
    filter.$or = [{ fullName: pattern }, { email: pattern }];
  }

  if (tier === 'free' || tier === 'premium') {
    filter.tier = tier;
  }

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    User.countDocuments(filter)
  ]);

  sendSuccess(res, {
    message: 'Users fetched successfully',
    data: users.map((user) => ({
      id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      tier: user.tier ?? 'free',
      premiumSource: user.premiumSource ?? null,
      premiumExpiresAt: user.premiumExpiresAt ?? null,
      createdAt: user.createdAt
    })),
    meta: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit)
    }
  });
});

export const getUser = catchAsync(async (req, res) => {
  const { userId } = req.params;

  const user = await User.findById(userId).lean();
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  }

  const now = new Date();

  const [subscriptions, couponRedemptions, auditLog] = await Promise.all([
    Subscription.find({
      userId,
      status: { $in: ['active', 'in_grace'] },
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
    })
      .sort({ expiresAt: -1 })
      .lean(),
    CouponRedemption.find({ userId }).sort({ redeemedAt: -1 }).lean(),
    listAuditForUser(userId, 50)
  ]);

  sendSuccess(res, {
    message: 'User fetched successfully',
    data: {
      user: adminUserDetail(user),
      subscriptions: subscriptions.map((subscription) => ({
        id: subscription._id,
        store: subscription.store,
        productId: subscription.productId,
        status: subscription.status,
        expiresAt: subscription.expiresAt,
        createdAt: subscription.createdAt,
        updatedAt: subscription.updatedAt
      })),
      couponRedemptions: couponRedemptions.map((redemption) => ({
        id: redemption._id,
        couponId: redemption.couponId,
        redeemedAt: redemption.redeemedAt
      })),
      auditLog: auditLog.map((entry) => ({
        id: entry._id,
        adminId: entry.adminId,
        action: entry.action,
        meta: entry.meta ?? null,
        createdAt: entry.createdAt
      }))
    }
  });
});

export const grantPremium = catchAsync(async (req, res) => {
  const adminId = req.auth.user._id;
  const { userId } = req.params;

  const exists = await User.exists({ _id: userId });
  if (!exists) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  }

  // durationDays null => lifetime. Reject non-positive / invalid numbers.
  let durationDays = null;
  if (req.body.durationDays !== null && req.body.durationDays !== undefined) {
    durationDays = parseIntegerInput(req.body.durationDays);
    if (durationDays === undefined || durationDays <= 0) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'durationDays must be a positive integer or null for a lifetime grant'
      );
    }
  }

  const user = await grantManual(userId, {
    durationDays,
    source: 'manual',
    adminId
  });

  // Always create the in-app notification so the user sees the Premium upgrade
  // in the bell/history screen, and attempt an immediate push. Push delivery
  // respects the master switch AND the per-channel push opt-out. This is a
  // transactional confirmation of an admin action, so it is intentionally NOT
  // gated by the "premium offers" category (which governs marketing pushes).
  const isItalian = user.preferredLanguage === 'it';
  const pushAllowed = pushEnabledForUser(user);
  const notifyResult = await notifyUser(userId, {
    title: isItalian ? 'Sei Premium!' : "You're Premium!",
    body: isItalian
      ? 'Il tuo account e stato aggiornato a Premium. Goditi tutte le funzioni sbloccate!'
      : 'Your account has been upgraded to Premium. Enjoy all the unlocked features!',
    type: 'premium_granted',
    data: { type: 'premium_granted', screen: 'home' },
    sendPush: pushAllowed
  });

  // If the immediate push could not be delivered — most commonly because the
  // user's device token was not registered at grant time (app closed / just
  // starting) — enqueue a reliable push-only retry. The dispatcher then delivers
  // it (with backoff) once the token is present, without a duplicate in-app
  // record. Best-effort: never let this break the grant response.
  if (
    pushAllowed &&
    notifyResult?.skipped &&
    (notifyResult.reason === 'no_tokens' || notifyResult.reason === 'error')
  ) {
    try {
      await enqueuePremiumActivationPush(userId, user.premiumExpiresAt ?? null);
    } catch (error) {
      console.error(
        '[adminUser.controller] premium activation push enqueue failed:',
        error?.message || error
      );
    }
  }

  await logAudit({
    adminId,
    action: 'user.grant_premium',
    targetUserId: userId,
    meta: {
      durationDays,
      lifetime: durationDays === null,
      source: 'manual'
    }
  });

  sendSuccess(res, {
    message:
      durationDays === null
        ? 'Lifetime premium granted successfully'
        : 'Premium granted successfully',
    data: adminUserDetail(user.toObject ? user.toObject() : user)
  });
});

export const revokePremium = catchAsync(async (req, res) => {
  const adminId = req.auth.user._id;
  const { userId } = req.params;

  const exists = await User.exists({ _id: userId });
  if (!exists) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  }

  const user = await revoke(userId, adminId);

  await logAudit({
    adminId,
    action: 'user.revoke_premium',
    targetUserId: userId,
    meta: { source: 'manual' }
  });

  sendSuccess(res, {
    message: 'Premium revoked successfully',
    data: adminUserDetail(user.toObject ? user.toObject() : user)
  });
});
