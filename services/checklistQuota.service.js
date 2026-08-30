import { StatusCodes } from 'http-status-codes';
import Checklist from '../models/checklist.model.js';
import ApiError from '../utils/ApiError.js';
import { isPremiumUser } from './premium.service.js';
import { getSetting } from './settings.service.js';

/**
 * A personalized copy of an admin template is also `type: custom`, but it is
 * not a checklist the user created. Only source-less custom rows consume this
 * plan allowance. The explicit missing-field branch covers legacy documents.
 */
export const buildUserCreatedChecklistQuery = (userId) => ({
  ownerId: userId,
  type: 'custom',
  $or: [
    { sourceChecklistId: null },
    { sourceChecklistId: { $exists: false } }
  ]
});

export const getCustomChecklistLimitSettingKey = (premium) =>
  premium ? 'premiumCustomChecklistLimit' : 'freeCustomChecklistLimit';

export const evaluateCustomChecklistQuota = ({
  used = 0,
  limit = 0,
  premium = false
}) => {
  const normalizedUsed = Math.max(0, Number.parseInt(used, 10) || 0);
  const normalizedLimit = Math.max(0, Number.parseInt(limit, 10) || 0);
  return {
    allowed: normalizedLimit === 0 || normalizedUsed < normalizedLimit,
    used: normalizedUsed,
    limit: normalizedLimit,
    remaining:
      normalizedLimit === 0
        ? null
        : Math.max(0, normalizedLimit - normalizedUsed),
    unlimited: normalizedLimit === 0,
    premium,
    tier: premium ? 'premium' : 'free'
  };
};

export const getCustomChecklistQuota = async (user) => {
  const premium = isPremiumUser(user);
  const [limit, used] = await Promise.all([
    getSetting(getCustomChecklistLimitSettingKey(premium)),
    Checklist.countDocuments(buildUserCreatedChecklistQuery(user?._id))
  ]);
  return evaluateCustomChecklistQuota({ used, limit, premium });
};

export const createChecklistLimitError = (quota) => {
  const tier = quota?.premium ? 'Premium' : 'Free';
  const limit = quota?.limit ?? 0;
  const used = quota?.used ?? 0;
  const err = new ApiError(
    StatusCodes.FORBIDDEN,
    `${tier} plan checklist allowance reached (${used}/${limit} in use). ` +
      (quota?.premium
        ? 'Delete an unused checklist before creating another.'
        : 'Delete an unused checklist or upgrade to Premium for a larger allowance.')
  );
  err.code = 'CHECKLIST_LIMIT_REACHED';
  err.details = {
    kind: 'customChecklists',
    feature: 'customChecklists',
    window: 'total',
    tier: quota?.tier || (quota?.premium ? 'premium' : 'free'),
    limit,
    used,
    remaining: quota?.remaining ?? 0,
    resetsAt: null,
    upgradeAvailable: !quota?.premium
  };
  return err;
};

export const enforceCustomChecklistLimit = async (user) => {
  const quota = await getCustomChecklistQuota(user);
  if (!quota.allowed) throw createChecklistLimitError(quota);
  return quota;
};
